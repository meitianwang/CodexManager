import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  codexAppDefaultModel,
  codexAppProviderId,
  codexAppProxyApiKeyEnvironmentVariable,
  type CodexAppIntegrationStatus
} from "../../shared/models/codex-app-integration";
import type { FileSystemPaths } from "../repositories/file-system-paths";
import { readTextFile, writeFileAtomically } from "../repositories/atomic-file-writer";
import { stableStringify } from "../repositories/stable-json";
import type { GUIEnvironmentServiceLike } from "../platform/types";
import type { ProxyRuntimeService } from "./proxy-runtime-service";

export interface CodexAppProxyRuntimeLike {
  getState(): Promise<{ apiKey: string; port: number }>;
}

export interface CodexAppIntegrationServiceOptions {
  unixSecondsNow?: () => number;
}

interface CodexAppIntegrationManifest {
  configuredAt: number;
  configuredConfigHash: string;
  envVarName: string;
  historyPatches?: LegacyCodexAppHistoryPatch[];
  previousRootModelLine?: string;
  previousRootModelProviderLine?: string;
  proxyURL: string;
  version: 1;
}

interface LegacyCodexAppHistoryPatch {
  appliedProvider: string;
  path: string;
  previousDatabaseProvider?: string;
  previousProvider: string | null;
}

interface ConfigReadResult {
  raw: string;
}

interface RootAssignment {
  index: number;
  line: string;
  value?: string;
}

const manifestFileName = "codex-app-integration.json";
const expectedProviderName = "CodexManager Proxy";
const expectedWireAPI = "responses";
const expectedRequestMaxRetries = "4";
const expectedStreamMaxRetries = "5";
const expectedStreamIdleTimeoutMs = "300000";
const maxSQLiteOutputBytes = 64 * 1024;
const sqlitePathChunkSize = 200;

export class CodexAppIntegrationService {
  private readonly unixSecondsNow: () => number;

  constructor(
    private readonly paths: FileSystemPaths,
    private readonly proxyRuntimeService: CodexAppProxyRuntimeLike | ProxyRuntimeService,
    private readonly guiEnvironmentService: GUIEnvironmentServiceLike,
    options: CodexAppIntegrationServiceOptions = {}
  ) {
    this.unixSecondsNow = options.unixSecondsNow ?? (() => Math.floor(Date.now() / 1000));
  }

  async status(): Promise<CodexAppIntegrationStatus> {
    const [config, manifest, proxy] = await Promise.all([
      this.readConfig(),
      this.readManifestOptional(),
      this.proxyRuntimeService.getState()
    ]);
    return this.statusFor(config.raw, manifest, this.proxyBaseURL(proxy.port));
  }

  async configure(): Promise<CodexAppIntegrationStatus> {
    const proxy = await this.proxyRuntimeService.getState();
    const proxyURL = this.proxyBaseURL(proxy.port);
    const config = await this.readConfig();
    const existingManifest = await this.readManifestOptional();
    const previousRoot = previousRootAssignments(config.raw);
    const withoutManagedBlock = removeManagedProviderBlock(config.raw);
    const configured = appendManagedProviderBlock(
      setManagedRootAssignments(withoutManagedBlock),
      providerBaseURL(proxyURL)
    );

    await writeFileAtomically(configured, this.paths.codexConfigPath);

    const manifest: CodexAppIntegrationManifest = {
      configuredAt: this.unixSecondsNow(),
      configuredConfigHash: sha256(configured),
      envVarName: codexAppProxyApiKeyEnvironmentVariable,
      ...(existingManifest?.historyPatches ? { historyPatches: existingManifest.historyPatches } : {}),
      previousRootModelLine: existingManifest?.previousRootModelLine ?? previousRoot.model?.line,
      previousRootModelProviderLine:
        existingManifest?.previousRootModelProviderLine ?? previousRoot.modelProvider?.line,
      proxyURL,
      version: 1
    };
    await this.writeManifest(manifest);

    let warning: string | undefined;
    try {
      warning = (await this.guiEnvironmentService.setEnvironmentVariable(codexAppProxyApiKeyEnvironmentVariable, proxy.apiKey)).warning;
    } catch (error) {
      warning = errorMessage(error);
    }

    return {
      ...this.statusFor(configured, manifest, proxyURL),
      ...(warning ? { warning } : {})
    };
  }

  async restore(): Promise<CodexAppIntegrationStatus> {
    const manifest = await this.readManifestOptional();
    const proxy = await this.proxyRuntimeService.getState();
    const proxyURL = this.proxyBaseURL(proxy.port);
    const config = await this.readConfig();
    const withoutManagedBlock = removeManagedProviderBlock(config.raw);
    const { raw: restored, warning } = restoreManagedRootAssignments(withoutManagedBlock, manifest);
    const historyRestore = await restoreLegacyCodexHistoryProviders(manifest?.historyPatches ?? []);
    if (restored !== config.raw || manifest !== undefined) {
      await writeFileAtomically(restored, this.paths.codexConfigPath);
      await this.clearManifest();
    }
    return this.statusFor(restored, undefined, proxyURL, [warning, ...historyRestore.warnings].filter(Boolean).join(" "));
  }

  private async readConfig(): Promise<ConfigReadResult> {
    try {
      return { raw: await readTextFile(this.paths.codexConfigPath) };
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return { raw: "" };
      }
      throw error;
    }
  }

  private manifestPath(): string {
    return join(this.paths.applicationSupportDirectory, manifestFileName);
  }

  private async readManifestOptional(): Promise<CodexAppIntegrationManifest | undefined> {
    try {
      return parseManifest(JSON.parse(await readFile(this.manifestPath(), "utf8")));
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeManifest(manifest: CodexAppIntegrationManifest): Promise<void> {
    await writeFileAtomically(stableStringify(manifest), this.manifestPath());
  }

  private async clearManifest(): Promise<void> {
    await rm(this.manifestPath(), { force: true });
  }

  private statusFor(
    raw: string,
    manifest: CodexAppIntegrationManifest | undefined,
    proxyURL: string,
    warning?: string
  ): CodexAppIntegrationStatus {
    const root = previousRootAssignments(raw);
    const providerValues = managedProviderValues(raw);
    const hasExpectedProvider =
      providerValues.name === expectedProviderName &&
      providerValues.base_url === providerBaseURL(proxyURL) &&
      providerValues.wire_api === expectedWireAPI &&
      providerValues.env_key === codexAppProxyApiKeyEnvironmentVariable &&
      providerValues.requires_openai_auth === "false" &&
      providerValues.request_max_retries === expectedRequestMaxRetries &&
      providerValues.stream_max_retries === expectedStreamMaxRetries &&
      providerValues.stream_idle_timeout_ms === expectedStreamIdleTimeoutMs;
    const hasRootSelection =
      root.model?.value === codexAppDefaultModel && root.modelProvider?.value === codexAppProviderId;
    const hasManagedConfig = providerValues.__present === "true" || root.modelProvider?.value === codexAppProviderId;
    const canRestore = manifest !== undefined || hasManagedConfig;

    let state: CodexAppIntegrationStatus["state"];
    if (hasExpectedProvider && hasRootSelection) {
      state = "configured";
    } else if (canRestore && hasManagedConfig) {
      state = "drifted";
    } else if (canRestore) {
      state = "restorable";
    } else {
      state = "not_configured";
    }

    return {
      canRestore,
      configPath: this.paths.codexConfigPath,
      model: root.model?.value ?? codexAppDefaultModel,
      providerId: root.modelProvider?.value ?? codexAppProviderId,
      proxyURL,
      state,
      ...(warning ? { warning } : {})
    };
  }

  private proxyBaseURL(port: number): string {
    return `http://127.0.0.1:${port}`;
  }
}

function parseManifest(value: unknown): CodexAppIntegrationManifest {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Invalid Codex.app integration metadata.");
  }
  const manifest: CodexAppIntegrationManifest = {
    configuredAt: requiredNumber(value.configuredAt, "configuredAt"),
    configuredConfigHash: requiredString(value.configuredConfigHash, "configuredConfigHash"),
    envVarName: requiredString(value.envVarName, "envVarName"),
    proxyURL: requiredString(value.proxyURL, "proxyURL"),
    version: 1
  };
  if (typeof value.previousRootModelLine === "string") {
    manifest.previousRootModelLine = value.previousRootModelLine;
  }
  if (typeof value.previousRootModelProviderLine === "string") {
    manifest.previousRootModelProviderLine = value.previousRootModelProviderLine;
  }
  if (Array.isArray(value.historyPatches)) {
    manifest.historyPatches = value.historyPatches.map(parseLegacyHistoryPatch);
  }
  return manifest;
}

function parseLegacyHistoryPatch(value: unknown): LegacyCodexAppHistoryPatch {
  if (!isRecord(value)) {
    throw new Error("Invalid Codex.app integration metadata: historyPatches item must be an object.");
  }
  const previousProvider = value.previousProvider;
  if (previousProvider !== null && typeof previousProvider !== "string") {
    throw new Error("Invalid Codex.app integration metadata: historyPatches.previousProvider must be a string or null.");
  }
  const previousDatabaseProvider = value.previousDatabaseProvider;
  if (previousDatabaseProvider !== undefined && typeof previousDatabaseProvider !== "string") {
    throw new Error("Invalid Codex.app integration metadata: historyPatches.previousDatabaseProvider must be a string.");
  }
  return {
    appliedProvider: requiredString(value.appliedProvider, "historyPatches.appliedProvider"),
    path: requiredString(value.path, "historyPatches.path"),
    previousDatabaseProvider,
    previousProvider
  };
}

function previousRootAssignments(raw: string): { model?: RootAssignment; modelProvider?: RootAssignment } {
  const { lines } = splitConfig(raw);
  return {
    model: rootAssignment(lines, "model"),
    modelProvider: rootAssignment(lines, "model_provider")
  };
}

function setManagedRootAssignments(raw: string): string {
  const split = splitConfig(raw);
  const tableIndex = firstTableIndex(split.lines);
  const lines = split.lines.filter((line, index) => {
    if (index >= tableIndex) {
      return true;
    }
    return !isRootAssignmentLine(line, "model") && !isRootAssignmentLine(line, "model_provider");
  });
  const insertionIndex = rootInsertionIndex(lines);
  const managedLines = [`model = "${codexAppDefaultModel}"`, `model_provider = "${codexAppProviderId}"`, ""];
  lines.splice(insertionIndex, 0, ...managedLines);
  return joinConfig(lines, split.newline);
}

function restoreManagedRootAssignments(
  raw: string,
  manifest: CodexAppIntegrationManifest | undefined
): { raw: string; warning?: string } {
  const split = splitConfig(raw);
  const warnings: string[] = [];
  const lines = [...split.lines];
  const provider = rootAssignment(lines, "model_provider");
  if (provider?.value !== codexAppProviderId) {
    return {
      raw: joinConfig(lines, split.newline)
    };
  }
  restoreRootLine(lines, "model", codexAppDefaultModel, manifest?.previousRootModelLine, warnings);
  restoreRootLine(lines, "model_provider", codexAppProviderId, manifest?.previousRootModelProviderLine, warnings);
  return {
    raw: joinConfig(lines, split.newline),
    warning: warnings.length > 0 ? warnings.join(" ") : undefined
  };
}

function restoreRootLine(
  lines: string[],
  key: string,
  managedValue: string,
  previousLine: string | undefined,
  warnings: string[]
): void {
  const assignment = rootAssignment(lines, key);
  if (!assignment) {
    return;
  }
  if (assignment.value !== managedValue) {
    warnings.push(`Preserved user-edited ${key}.`);
    return;
  }
  if (previousLine !== undefined) {
    lines[assignment.index] = previousLine;
  } else {
    lines.splice(assignment.index, 1);
  }
}

function appendManagedProviderBlock(raw: string, baseURL: string): string {
  const trimmed = raw.trimEnd();
  const prefix = trimmed ? `${trimmed}\n\n` : "";
  return `${prefix}${managedProviderBlock(baseURL)}\n`;
}

function managedProviderBlock(baseURL: string): string {
  return [
    `[model_providers.${codexAppProviderId}]`,
    `name = "${expectedProviderName}"`,
    `base_url = "${baseURL}"`,
    `wire_api = "${expectedWireAPI}"`,
    `env_key = "${codexAppProxyApiKeyEnvironmentVariable}"`,
    "requires_openai_auth = false",
    `request_max_retries = ${expectedRequestMaxRetries}`,
    `stream_max_retries = ${expectedStreamMaxRetries}`,
    `stream_idle_timeout_ms = ${expectedStreamIdleTimeoutMs}`
  ].join("\n");
}

function removeManagedProviderBlock(raw: string): string {
  const split = splitConfig(raw);
  const nextLines: string[] = [];
  let skip = false;
  for (const line of split.lines) {
    const tableName = tableHeaderName(line);
    if (tableName) {
      skip = isManagedProviderTable(tableName);
      if (skip) {
        continue;
      }
    }
    if (!skip) {
      nextLines.push(line);
    }
  }
  return joinConfig(trimTrailingBlankLines(nextLines), split.newline);
}

function managedProviderValues(raw: string): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  const split = splitConfig(raw);
  let inManagedTable = false;
  for (const line of split.lines) {
    const tableName = tableHeaderName(line);
    if (tableName) {
      inManagedTable = tableName === `model_providers.${codexAppProviderId}`;
      if (inManagedTable) {
        values.__present = "true";
      }
      continue;
    }
    if (!inManagedTable) {
      continue;
    }
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (!match) {
      continue;
    }
    values[match[1] ?? ""] = parseTomlScalar(match[2] ?? "");
  }
  return values;
}

function rootAssignment(lines: readonly string[], key: string): RootAssignment | undefined {
  const tableIndex = firstTableIndex(lines);
  for (let index = 0; index < tableIndex; index += 1) {
    const line = lines[index] ?? "";
    if (!isRootAssignmentLine(line, key)) {
      continue;
    }
    return {
      index,
      line,
      value: parseTomlScalar(line.replace(/^\s*[A-Za-z0-9_-]+\s*=\s*/, ""))
    };
  }
  return undefined;
}

function isRootAssignmentLine(line: string, key: string): boolean {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line);
}

function firstTableIndex(lines: readonly string[]): number {
  const index = lines.findIndex((line) => tableHeaderName(line) !== undefined);
  return index >= 0 ? index : lines.length;
}

function rootInsertionIndex(lines: readonly string[]): number {
  const tableIndex = firstTableIndex(lines);
  for (let index = 0; index < tableIndex; index += 1) {
    const trimmed = (lines[index] ?? "").trim();
    if (trimmed && !trimmed.startsWith("#")) {
      return index;
    }
  }
  return tableIndex;
}

function tableHeaderName(line: string): string | undefined {
  return line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/)?.[1]?.trim();
}

function isManagedProviderTable(tableName: string): boolean {
  return tableName === `model_providers.${codexAppProviderId}` || tableName.startsWith(`model_providers.${codexAppProviderId}.`);
}

function providerBaseURL(proxyURL: string): string {
  return `${proxyURL}/v1`;
}

function splitConfig(raw: string): { lines: string[]; newline: string } {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  if (!raw) {
    return { lines: [], newline };
  }
  const lines = raw.split(/\r?\n/);
  if (raw.endsWith("\n")) {
    lines.pop();
  }
  return { lines, newline };
}

function joinConfig(lines: readonly string[], newline: string): string {
  return lines.length > 0 ? `${lines.join(newline)}${newline}` : "";
}

function trimTrailingBlankLines(lines: readonly string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && (next[next.length - 1] ?? "").trim() === "") {
    next.pop();
  }
  return next;
}

async function restoreLegacyCodexHistoryProviders(
  patches: readonly LegacyCodexAppHistoryPatch[]
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  for (const patch of patches) {
    try {
      await restoreLegacyRolloutFileProvider(patch);
    } catch (error) {
      warnings.push(`Skipped legacy Codex history provider restore for ${patch.path}: ${errorMessage(error)}.`);
    }
  }
  warnings.push(...(await restoreLegacyHistoryDatabaseProviders(patches)).warnings);
  return { warnings };
}

async function restoreLegacyRolloutFileProvider(patch: LegacyCodexAppHistoryPatch): Promise<void> {
  const rollout = parseLegacyRolloutHead(await readTextFile(patch.path));
  if (!rollout || rollout.provider !== patch.appliedProvider) {
    return;
  }
  if (patch.previousProvider === null) {
    delete rollout.payload.model_provider;
  } else {
    rollout.payload.model_provider = patch.previousProvider;
  }
  await writeFileAtomically(renderLegacyRolloutHead(rollout), patch.path);
}

async function restoreLegacyHistoryDatabaseProviders(
  patches: readonly LegacyCodexAppHistoryPatch[]
): Promise<{ warnings: string[] }> {
  if (patches.length === 0) {
    return { warnings: [] };
  }
  const databasePaths = await listLegacyCodexStateDatabases(patches.map((patch) => patch.path));
  if (databasePaths.length === 0) {
    return { warnings: [] };
  }

  const warnings: string[] = [];
  const patchesByPreviousProvider = new Map<string, LegacyCodexAppHistoryPatch[]>();
  for (const patch of patches) {
    const previousProvider = patch.previousDatabaseProvider ?? (patch.previousProvider === "openai" ? "openai" : undefined);
    if (!previousProvider) {
      continue;
    }
    const providerPatches = patchesByPreviousProvider.get(previousProvider) ?? [];
    providerPatches.push(patch);
    patchesByPreviousProvider.set(previousProvider, providerPatches);
  }

  for (const [previousProvider, providerPatches] of patchesByPreviousProvider) {
    const script = sqliteUpdateScript(providerPatches.map((patch) => patch.path), codexAppProviderId, previousProvider);
    for (const databasePath of databasePaths) {
      try {
        await runSQLiteScript(databasePath, script);
      } catch (error) {
        warnings.push(`Skipped legacy Codex history database provider restore for ${databasePath}: ${errorMessage(error)}.`);
      }
    }
  }

  return { warnings };
}

async function listLegacyCodexStateDatabases(pathsInsideCodexHome: readonly string[]): Promise<string[]> {
  const codexHomes = [...new Set(pathsInsideCodexHome.map(codexHomeFromPath))];
  const databasePaths: string[] = [];
  for (const codexHome of codexHomes) {
    let entries;
    try {
      entries = await readdir(codexHome, { withFileTypes: true });
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        continue;
      }
      throw error;
    }
    databasePaths.push(
      ...entries
        .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/.test(entry.name))
        .map((entry) => join(codexHome, entry.name))
    );
  }
  return [...new Set(databasePaths)].sort((left, right) => left.localeCompare(right));
}

function codexHomeFromPath(pathInsideCodexHome: string): string {
  const codexHomeName = ".codex";
  const parts = pathInsideCodexHome.split("/");
  const index = parts.lastIndexOf(codexHomeName);
  return index >= 0 ? parts.slice(0, index + 1).join("/") || "/" : dirname(pathInsideCodexHome);
}

function sqliteUpdateScript(paths: readonly string[], currentProvider: string, nextProvider: string): string {
  const statements = ["BEGIN;"];
  for (const chunk of chunks(paths, sqlitePathChunkSize)) {
    if (chunk.length === 0) {
      continue;
    }
    statements.push(
      `UPDATE threads SET model_provider = ${sqliteString(nextProvider)} WHERE model_provider = ${sqliteString(currentProvider)} AND rollout_path IN (${chunk.map(sqliteString).join(", ")});`
    );
  }
  statements.push("COMMIT;");
  return statements.join("\n");
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function sqliteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runSQLiteScript(databasePath: string, script: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sqlite3", [databasePath], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const appendStdout = (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString("utf8"), maxSQLiteOutputBytes);
    };
    const appendStderr = (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString("utf8"), maxSQLiteOutputBytes);
    };

    child.stdout?.on("data", appendStdout);
    child.stderr?.on("data", appendStderr);
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`sqlite3 exited with ${code ?? "unknown"}${stderr ? `: ${stderr.trim()}` : ""}${stdout ? ` stdout: ${stdout.trim()}` : ""}`));
    });
    child.stdin?.end(script);
  });
}

function appendBounded(current: string, next: string, maxBytes: number): string {
  const combined = `${current}${next}`;
  if (Buffer.byteLength(combined, "utf8") <= maxBytes) {
    return combined;
  }
  return combined.slice(-maxBytes);
}

interface LegacyParsedRolloutHead {
  firstLine: Record<string, unknown>;
  payload: Record<string, unknown>;
  provider: string | null;
  rest: string;
}

function parseLegacyRolloutHead(raw: string): LegacyParsedRolloutHead | undefined {
  const newlineIndex = raw.indexOf("\n");
  const firstLineRaw = newlineIndex >= 0 ? raw.slice(0, newlineIndex) : raw;
  const rest = newlineIndex >= 0 ? raw.slice(newlineIndex) : "";
  if (!firstLineRaw.trim()) {
    return undefined;
  }

  const firstLine = JSON.parse(firstLineRaw) as unknown;
  if (!isRecord(firstLine) || firstLine.type !== "session_meta" || !isRecord(firstLine.payload)) {
    return undefined;
  }

  return {
    firstLine,
    payload: firstLine.payload,
    provider: typeof firstLine.payload.model_provider === "string" ? firstLine.payload.model_provider : null,
    rest
  };
}

function renderLegacyRolloutHead(rollout: LegacyParsedRolloutHead): string {
  return `${JSON.stringify(rollout.firstLine)}${rollout.rest || "\n"}`;
}

function parseTomlScalar(rawValue: string): string | undefined {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith('"')) {
    const match = trimmed.match(/^"((?:\\.|[^"\\])*)"/);
    if (!match) {
      return undefined;
    }
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return match[1];
    }
  }
  if (trimmed === "true" || trimmed === "false") {
    return trimmed;
  }
  return trimmed.match(/^[^\s#]+/)?.[0];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid Codex.app integration metadata: ${key} must be a string.`);
  }
  return value;
}

function requiredNumber(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid Codex.app integration metadata: ${key} must be a number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
