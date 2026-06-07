import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
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
  historyPatches?: CodexAppHistoryPatch[];
  historySyncedAt?: number;
  previousRootModelLine?: string;
  previousRootModelProviderLine?: string;
  proxyURL: string;
  version: 1;
}

interface CodexAppHistoryPatch {
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
const managedCodexEnvStart = "# BEGIN CODEXMANAGER CODEX.APP PROXY";
const managedCodexEnvEnd = "# END CODEXMANAGER CODEX.APP PROXY";
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
    await writeManagedCodexEnv(this.codexEnvPath(), codexAppProxyApiKeyEnvironmentVariable, proxy.apiKey);
    const historySync = await syncCodexHistoryProviders(
      this.paths.codexConfigPath,
      existingManifest?.historyPatches ?? []
    );

    const manifest: CodexAppIntegrationManifest = {
      configuredAt: this.unixSecondsNow(),
      configuredConfigHash: sha256(configured),
      envVarName: codexAppProxyApiKeyEnvironmentVariable,
      historyPatches: historySync.patches,
      historySyncedAt: this.unixSecondsNow(),
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
      warning: [warning, ...historySync.warnings].filter(Boolean).join(" ")
    };
  }

  async restore(): Promise<CodexAppIntegrationStatus> {
    const manifest = await this.readManifestOptional();
    const proxy = await this.proxyRuntimeService.getState();
    const proxyURL = this.proxyBaseURL(proxy.port);
    const config = await this.readConfig();
    const withoutManagedBlock = removeManagedProviderBlock(config.raw);
    const { raw: restored, warning } = restoreManagedRootAssignments(withoutManagedBlock, manifest);
    let envWarning: string | undefined;
    try {
      await removeManagedCodexEnv(this.codexEnvPath());
      envWarning = (await this.guiEnvironmentService.unsetEnvironmentVariable?.(codexAppProxyApiKeyEnvironmentVariable))?.warning;
    } catch (error) {
      envWarning = `Skipped Codex.app provider key restore: ${errorMessage(error)}.`;
    }
    const discoveredHistoryRestore = await discoverCodexHistoryRestorePatches(this.paths.codexConfigPath);
    const historyPatches = mergeHistoryPatches([
      ...(manifest?.historyPatches ?? []),
      ...discoveredHistoryRestore.patches
    ]);
    const historyRestore = await restoreCodexHistoryProviders(historyPatches, this.paths.codexConfigPath);
    if (restored !== config.raw || manifest !== undefined) {
      await writeFileAtomically(restored, this.paths.codexConfigPath);
      await this.clearManifest();
    }
    return this.statusFor(
      restored,
      undefined,
      proxyURL,
      [warning, envWarning, ...discoveredHistoryRestore.warnings, ...historyRestore.warnings].filter(Boolean).join(" ")
    );
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

  private codexEnvPath(): string {
    return join(dirname(this.paths.codexConfigPath), ".env");
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
    manifest.historyPatches = value.historyPatches.map(parseHistoryPatch);
  }
  if (typeof value.historySyncedAt === "number") {
    manifest.historySyncedAt = value.historySyncedAt;
  }
  return manifest;
}

function parseHistoryPatch(value: unknown): CodexAppHistoryPatch {
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

function previousRootAssignments(raw: string): { model?: RootAssignment; modelProvider?: RootAssignment; sqliteHome?: RootAssignment } {
  const { lines } = splitConfig(raw);
  return {
    model: rootAssignment(lines, "model"),
    modelProvider: rootAssignment(lines, "model_provider"),
    sqliteHome: rootAssignment(lines, "sqlite_home")
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

async function writeManagedCodexEnv(path: string, keyName: string, keyValue: string): Promise<void> {
  const raw = await readOptionalTextFile(path);
  const withoutManagedBlock = removeManagedCodexEnvBlock(raw).trimEnd();
  const prefix = withoutManagedBlock ? `${withoutManagedBlock}\n\n` : "";
  await writeFileAtomically(`${prefix}${managedCodexEnvBlock(keyName, keyValue)}\n`, path);
}

async function removeManagedCodexEnv(path: string): Promise<void> {
  const raw = await readOptionalTextFile(path);
  const withoutManagedBlock = removeManagedCodexEnvBlock(raw).trimEnd();
  if (!withoutManagedBlock) {
    await rm(path, { force: true });
    return;
  }
  await writeFileAtomically(`${withoutManagedBlock}\n`, path);
}

async function readOptionalTextFile(path: string): Promise<string> {
  try {
    return await readTextFile(path);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return "";
    }
    throw error;
  }
}

function managedCodexEnvBlock(keyName: string, keyValue: string): string {
  return [managedCodexEnvStart, `export ${keyName}=${JSON.stringify(keyValue)}`, managedCodexEnvEnd].join("\n");
}

function removeManagedCodexEnvBlock(raw: string): string {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  const nextLines: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === managedCodexEnvStart) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim() === managedCodexEnvEnd) {
      skipping = false;
      continue;
    }
    if (!skipping) {
      nextLines.push(line);
    }
  }
  return nextLines.join(newline);
}

async function syncCodexHistoryProviders(
  codexConfigPath: string,
  existingPatches: readonly CodexAppHistoryPatch[]
): Promise<{ patches: CodexAppHistoryPatch[]; warnings: string[] }> {
  const existingPatchByPath = new Map(existingPatches.map((patch) => [patch.path, patch]));
  const patches = new Map(existingPatchByPath);
  const warnings: string[] = [];
  const rolloutPaths = await listRolloutFiles(codexConfigPath);

  for (const path of rolloutPaths) {
    try {
      const patch = await syncRolloutFileProvider(path, existingPatchByPath.get(path));
      if (patch) {
        patches.set(path, patch);
      }
    } catch (error) {
      warnings.push(`Skipped Codex history provider sync for ${path}: ${errorMessage(error)}.`);
    }
  }

  const databaseSync = await syncHistoryDatabaseProviders(codexConfigPath, [...patches.values()]);
  warnings.push(...databaseSync.warnings);

  return {
    patches: databaseSync.patches.sort((left, right) => left.path.localeCompare(right.path)),
    warnings
  };
}

async function restoreCodexHistoryProviders(
  patches: readonly CodexAppHistoryPatch[],
  codexConfigPath?: string
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  for (const patch of patches) {
    try {
      await restoreRolloutFileProvider(patch);
    } catch (error) {
      warnings.push(`Skipped Codex history provider restore for ${patch.path}: ${errorMessage(error)}.`);
    }
  }
  warnings.push(...(await restoreHistoryDatabaseProviders(patches, codexConfigPath)).warnings);
  return { warnings };
}

function mergeHistoryPatches(patches: readonly CodexAppHistoryPatch[]): CodexAppHistoryPatch[] {
  const byPath = new Map<string, CodexAppHistoryPatch>();
  for (const patch of patches) {
    const existing = byPath.get(patch.path);
    if (!existing) {
      byPath.set(patch.path, patch);
      continue;
    }
    byPath.set(patch.path, {
      ...patch,
      previousDatabaseProvider: existing.previousDatabaseProvider ?? patch.previousDatabaseProvider,
      previousProvider: existing.previousProvider
    });
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function discoverCodexHistoryRestorePatches(
  codexConfigPath: string
): Promise<{ patches: CodexAppHistoryPatch[]; warnings: string[] }> {
  const warnings: string[] = [];
  const patches = new Map<string, CodexAppHistoryPatch>();

  let rolloutPaths: string[] = [];
  try {
    rolloutPaths = await listRolloutFiles(codexConfigPath);
  } catch (error) {
    warnings.push(`Skipped Codex history restore scan: ${errorMessage(error)}.`);
  }

  for (const path of rolloutPaths) {
    try {
      const rollout = parseRolloutProviders(await readTextFile(path));
      if (rollout.providers.has(codexAppProviderId)) {
        patches.set(path, {
          appliedProvider: codexAppProviderId,
          path,
          previousProvider: "openai"
        });
      }
    } catch (error) {
      warnings.push(`Skipped Codex history restore scan for ${path}: ${errorMessage(error)}.`);
    }
  }

  const databasePaths = await listCodexStateDatabases([codexConfigPath, ...patches.keys()], codexConfigPath);
  for (const databasePath of databasePaths) {
    let databaseRolloutPaths: string[];
    try {
      databaseRolloutPaths = await runSQLiteQuery(
        databasePath,
        `SELECT rollout_path FROM threads WHERE model_provider = ${sqliteString(codexAppProviderId)};`
      );
    } catch (error) {
      warnings.push(`Skipped Codex history database restore scan for ${databasePath}: ${errorMessage(error)}.`);
      continue;
    }

    for (const path of databaseRolloutPaths) {
      const existing = patches.get(path);
      if (existing) {
        patches.set(path, {
          ...existing,
          previousDatabaseProvider: existing.previousDatabaseProvider ?? "openai"
        });
        continue;
      }

      let previousProvider = "openai";
      try {
        const rollout = parseRolloutProviders(await readTextFile(path));
        const firstNonManagedProvider = [...rollout.providers].find((provider) => provider !== codexAppProviderId);
        if (firstNonManagedProvider) {
          previousProvider = firstNonManagedProvider;
        }
      } catch {
        // Missing rollout files still need their sqlite rows restored.
      }
      patches.set(path, {
        appliedProvider: codexAppProviderId,
        path,
        previousDatabaseProvider: previousProvider,
        previousProvider
      });
    }
  }

  return { patches: [...patches.values()].sort((left, right) => left.path.localeCompare(right.path)), warnings };
}

async function listRolloutFiles(codexConfigPath: string): Promise<string[]> {
  const codexHome = dirname(codexConfigPath);
  const roots = [join(codexHome, "sessions"), join(codexHome, "archived_sessions")];
  const results: string[] = [];
  for (const root of roots) {
    await collectRolloutFiles(root, results);
  }
  return results.sort((left, right) => left.localeCompare(right));
}

async function collectRolloutFiles(directory: string, results: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectRolloutFiles(path, results);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(path);
    }
  }
}

async function syncRolloutFileProvider(
  path: string,
  existingPatch: CodexAppHistoryPatch | undefined
): Promise<CodexAppHistoryPatch | undefined> {
  const raw = await readTextFile(path);
  const rewrite = rewriteSessionMetaProviders(raw, {
    fromProviders: [null, "openai"],
    toProvider: codexAppProviderId
  });
  if (!rewrite.changed) {
    return existingPatch;
  }
  const patch: CodexAppHistoryPatch = {
    appliedProvider: codexAppProviderId,
    path,
    previousProvider: existingPatch ? existingPatch.previousProvider : rewrite.firstPreviousProvider
  };
  await writeFileAtomically(rewrite.raw, path);
  return patch;
}

async function restoreRolloutFileProvider(patch: CodexAppHistoryPatch): Promise<void> {
  const raw = await readTextFile(patch.path);
  const rewrite = rewriteSessionMetaProviders(raw, {
    fromProviders: [patch.appliedProvider],
    toProvider: patch.previousProvider
  });
  if (!rewrite.changed) {
    return;
  }
  await writeFileAtomically(rewrite.raw, patch.path);
}

async function syncHistoryDatabaseProviders(
  codexConfigPath: string,
  patches: readonly CodexAppHistoryPatch[]
): Promise<{ patches: CodexAppHistoryPatch[]; warnings: string[] }> {
  const databasePaths = await listCodexStateDatabases([codexConfigPath], codexConfigPath);
  const openAIHistoryPatches = patches.filter(
    (patch) =>
      patch.previousDatabaseProvider === "openai" ||
      patch.previousProvider === "openai" ||
      patch.previousProvider === null
  );
  if (databasePaths.length === 0 || openAIHistoryPatches.length === 0) {
    return { patches: [...patches], warnings: [] };
  }

  const warnings: string[] = [];
  const script = sqliteUpdateScript(openAIHistoryPatches.map((patch) => patch.path), "openai", codexAppProviderId);
  for (const databasePath of databasePaths) {
    try {
      await runSQLiteScript(databasePath, script);
    } catch (error) {
      warnings.push(`Skipped Codex history database provider sync for ${databasePath}: ${errorMessage(error)}.`);
    }
  }

  return {
    patches: patches.map((patch) =>
      patch.previousDatabaseProvider === undefined &&
      (patch.previousProvider === "openai" || patch.previousProvider === null)
        ? { ...patch, previousDatabaseProvider: "openai" }
        : patch
    ),
    warnings
  };
}

async function restoreHistoryDatabaseProviders(
  patches: readonly CodexAppHistoryPatch[],
  codexConfigPath?: string
): Promise<{ warnings: string[] }> {
  if (patches.length === 0) {
    return { warnings: [] };
  }
  const databasePaths = await listCodexStateDatabases(
    codexConfigPath ? [codexConfigPath, ...patches.map((patch) => patch.path)] : patches.map((patch) => patch.path),
    codexConfigPath
  );
  if (databasePaths.length === 0) {
    return { warnings: [] };
  }

  const warnings: string[] = [];
  const patchesByPreviousProvider = new Map<string, CodexAppHistoryPatch[]>();
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
        warnings.push(`Skipped Codex history database provider restore for ${databasePath}: ${errorMessage(error)}.`);
      }
    }
  }

  return { warnings };
}

async function listCodexStateDatabases(pathsInsideCodexHome: readonly string[], codexConfigPath?: string): Promise<string[]> {
  const codexHomes = new Set(pathsInsideCodexHome.map(codexHomeFromPath));
  if (codexConfigPath) {
    codexHomes.add(dirname(codexConfigPath));
    const sqliteHome = await sqliteHomeFromCodexConfig(codexConfigPath);
    if (sqliteHome) {
      codexHomes.add(sqliteHome);
    }
  }
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

async function sqliteHomeFromCodexConfig(codexConfigPath: string): Promise<string | undefined> {
  try {
    const raw = await readTextFile(codexConfigPath);
    const value = previousRootAssignments(raw).sqliteHome?.value?.trim();
    return value ? resolveUserPath(value) : undefined;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

function resolveUserPath(raw: string): string {
  if (raw === "~") {
    return homedir();
  }
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return join(homedir(), raw.slice(2));
  }
  return raw;
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

async function runSQLiteQuery(databasePath: string, query: string): Promise<string[]> {
  return await new Promise<string[]>((resolve, reject) => {
    const child = spawn("sqlite3", ["-batch", "-noheader", databasePath, query], {
      stdio: ["ignore", "pipe", "pipe"]
    });
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
        resolve(stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
        return;
      }
      reject(new Error(`sqlite3 exited with ${code ?? "unknown"}${stderr ? `: ${stderr.trim()}` : ""}${stdout ? ` stdout: ${stdout.trim()}` : ""}`));
    });
  });
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

function parseRolloutProviders(raw: string): { providers: Set<string> } {
  const providers = new Set<string>();
  for (const segment of splitLinesPreservingNewline(raw)) {
    const line = segment.endsWith("\n") ? segment.slice(0, -1) : segment;
    const parsed = parseSessionMetaLine(line);
    if (parsed?.provider) {
      providers.add(parsed.provider);
    }
  }
  return { providers };
}

function rewriteSessionMetaProviders(
  raw: string,
  options: { fromProviders: readonly (string | null)[]; toProvider: string | null }
): { changed: boolean; firstPreviousProvider: string | null; raw: string } {
  const fromProviders = new Set(options.fromProviders);
  let changed = false;
  let firstPreviousProvider: string | null | undefined;
  const next = splitLinesPreservingNewline(raw).map((segment) => {
    const hasNewline = segment.endsWith("\n");
    const line = hasNewline ? segment.slice(0, -1) : segment;
    const parsed = parseSessionMetaLine(line);
    if (!parsed || !fromProviders.has(parsed.provider)) {
      return segment;
    }

    if (firstPreviousProvider === undefined) {
      firstPreviousProvider = parsed.provider;
    }
    if (options.toProvider === null) {
      delete parsed.payload.model_provider;
    } else {
      parsed.payload.model_provider = options.toProvider;
    }
    changed = true;
    return `${JSON.stringify(parsed.value)}${hasNewline ? "\n" : ""}`;
  }).join("");

  return {
    changed,
    firstPreviousProvider: firstPreviousProvider ?? null,
    raw: next
  };
}

function parseSessionMetaLine(line: string): { payload: Record<string, unknown>; provider: string | null; value: Record<string, unknown> } | undefined {
  if (!line.includes("session_meta")) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.type !== "session_meta" || !isRecord(value.payload)) {
    return undefined;
  }
  return {
    payload: value.payload,
    provider: typeof value.payload.model_provider === "string" ? value.payload.model_provider : null,
    value
  };
}

function splitLinesPreservingNewline(raw: string): string[] {
  if (!raw) {
    return [];
  }
  return raw.match(/[^\n]*\n|[^\n]+$/g) ?? [];
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
