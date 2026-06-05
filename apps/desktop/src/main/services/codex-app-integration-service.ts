import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
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
  backupPath: string;
  configuredAt: number;
  configuredConfigHash: string;
  envVarName: string;
  originalConfigExisted: boolean;
  originalConfigHash: string;
  previousRootModelLine?: string;
  previousRootModelProviderLine?: string;
  proxyURL: string;
  version: 1;
}

interface ConfigReadResult {
  existed: boolean;
  raw: string;
}

interface RootAssignment {
  index: number;
  line: string;
  value?: string;
}

const manifestFileName = "codex-app-integration.json";
const backupDirectoryName = "codex-config-backups";
const expectedProviderName = "CodexManager Proxy";
const expectedWireAPI = "responses";
const expectedRequestMaxRetries = "1";
const expectedStreamMaxRetries = "1";
const expectedStreamIdleTimeoutMs = "300000";

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
    const backupPath = existingManifest?.backupPath ?? (await this.writeBackup(config.raw));
    const originalConfigExisted = existingManifest?.originalConfigExisted ?? config.existed;
    const originalConfigHash = existingManifest?.originalConfigHash ?? sha256(config.raw);
    const withoutManagedBlock = removeManagedProviderBlock(config.raw);
    const configured = appendManagedProviderBlock(
      setManagedRootAssignments(withoutManagedBlock),
      providerBaseURL(proxyURL)
    );

    await writeFileAtomically(configured, this.paths.codexConfigPath);

    const manifest: CodexAppIntegrationManifest = {
      backupPath,
      configuredAt: this.unixSecondsNow(),
      configuredConfigHash: sha256(configured),
      envVarName: codexAppProxyApiKeyEnvironmentVariable,
      originalConfigExisted,
      originalConfigHash,
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
      warning: warning ?? "Restart Codex.app so GUI sessions inherit the updated provider key."
    };
  }

  async restoreSafe(): Promise<CodexAppIntegrationStatus> {
    const manifest = await this.readManifestRequired();
    const proxy = await this.proxyRuntimeService.getState();
    const proxyURL = this.proxyBaseURL(proxy.port);
    const config = await this.readConfig();
    const withoutManagedBlock = removeManagedProviderBlock(config.raw);
    const { raw: restored, warning } = restoreManagedRootAssignments(withoutManagedBlock, manifest);
    await writeFileAtomically(restored, this.paths.codexConfigPath);
    await this.clearManifest();
    return this.statusFor(restored, undefined, proxyURL, warning);
  }

  async restoreSnapshot(): Promise<CodexAppIntegrationStatus> {
    const manifest = await this.readManifestRequired();
    const proxy = await this.proxyRuntimeService.getState();
    const proxyURL = this.proxyBaseURL(proxy.port);
    if (manifest.originalConfigExisted) {
      await writeFileAtomically(await readTextFile(manifest.backupPath), this.paths.codexConfigPath);
    } else {
      await rm(this.paths.codexConfigPath, { force: true });
    }
    await this.clearManifest();
    const config = await this.readConfig();
    return this.statusFor(config.raw, undefined, proxyURL);
  }

  private async readConfig(): Promise<ConfigReadResult> {
    try {
      return { existed: true, raw: await readTextFile(this.paths.codexConfigPath) };
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return { existed: false, raw: "" };
      }
      throw error;
    }
  }

  private async writeBackup(raw: string): Promise<string> {
    const backupDirectory = join(this.paths.applicationSupportDirectory, backupDirectoryName);
    await mkdir(backupDirectory, { recursive: true });
    const backupPath = join(backupDirectory, `config-${this.unixSecondsNow()}.toml`);
    await writeFileAtomically(raw, backupPath);
    return backupPath;
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

  private async readManifestRequired(): Promise<CodexAppIntegrationManifest> {
    const manifest = await this.readManifestOptional();
    if (!manifest) {
      throw new Error("Codex.app integration has no restore metadata.");
    }
    return manifest;
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
    const hasBackup = manifest?.backupPath !== undefined;

    let state: CodexAppIntegrationStatus["state"];
    if (hasExpectedProvider && hasRootSelection) {
      state = "configured";
    } else if (manifest && (providerValues.__present === "true" || root.modelProvider?.value === codexAppProviderId)) {
      state = "drifted";
    } else if (manifest && hasBackup) {
      state = "restorable";
    } else {
      state = "not_configured";
    }

    return {
      configPath: this.paths.codexConfigPath,
      hasBackup,
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
    backupPath: requiredString(value.backupPath, "backupPath"),
    configuredAt: requiredNumber(value.configuredAt, "configuredAt"),
    configuredConfigHash: requiredString(value.configuredConfigHash, "configuredConfigHash"),
    envVarName: requiredString(value.envVarName, "envVarName"),
    originalConfigExisted: requiredBoolean(value.originalConfigExisted, "originalConfigExisted"),
    originalConfigHash: requiredString(value.originalConfigHash, "originalConfigHash"),
    proxyURL: requiredString(value.proxyURL, "proxyURL"),
    version: 1
  };
  if (typeof value.previousRootModelLine === "string") {
    manifest.previousRootModelLine = value.previousRootModelLine;
  }
  if (typeof value.previousRootModelProviderLine === "string") {
    manifest.previousRootModelProviderLine = value.previousRootModelProviderLine;
  }
  return manifest;
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
  manifest: CodexAppIntegrationManifest
): { raw: string; warning?: string } {
  const split = splitConfig(raw);
  const warnings: string[] = [];
  const lines = [...split.lines];
  restoreRootLine(lines, "model", codexAppDefaultModel, manifest.previousRootModelLine, warnings);
  restoreRootLine(lines, "model_provider", codexAppProviderId, manifest.previousRootModelProviderLine, warnings);
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

function requiredBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid Codex.app integration metadata: ${key} must be a boolean.`);
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
