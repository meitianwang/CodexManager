#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { arch, homedir, tmpdir } from "node:os";
import { join, posix } from "node:path";

const require = createRequire(import.meta.url);

const approvalEnvName = "CODEX_MANAGER_ALLOW_REAL_MACOS_SIDE_EFFECTS";
const approvalEnvValue = "1";
const maxCommandOutputBytes = 8 * 1024;
const validCheckIDs = new Set([
  "oauth-browser-login",
  "codex-launch",
  "editor-restart",
  "login-item",
  "settings-write"
]);

const options = parseOptions(process.argv.slice(2));
const approvalGranted = process.env[approvalEnvName] === approvalEnvValue;

if (process.platform !== "darwin") {
  printReport({
    status: "skipped",
    platform: process.platform,
    reason: "macOS real side-effect verification only runs on darwin",
    sideEffects: noSideEffects()
  });
  process.exit(0);
}

if (!options.execute) {
  printReport({
    status: "approval-required",
    platform: process.platform,
    executionMode: "dry-run-verifier",
    approvalGate: approvalGate(approvalGranted),
    selectedChecks: options.checks,
    checks: [...validCheckIDs].map((id) => ({
      id,
      readyToExecute: false,
      reason: "Pass --execute, one or more --check values, and the approval environment variable to run this check."
    })),
    sideEffects: noSideEffects()
  });
  process.exit(0);
}

if (!approvalGranted) {
  printReport({
    status: "blocked",
    platform: process.platform,
    executionMode: "execute-requested",
    approvalGate: approvalGate(false),
    selectedChecks: options.checks,
    error: `Refusing to run real macOS side-effect checks without ${approvalEnvName}=${approvalEnvValue}`,
    sideEffects: noSideEffects()
  });
  process.exit(1);
}

if (options.checks.length === 0) {
  printReport({
    status: "blocked",
    platform: process.platform,
    executionMode: "execute-requested",
    approvalGate: approvalGate(true),
    selectedChecks: [],
    error: "Refusing to run every real side-effect check implicitly. Pass one or more --check values.",
    sideEffects: noSideEffects()
  });
  process.exit(1);
}

const invalidChecks = options.checks.filter((id) => !validCheckIDs.has(id));
if (invalidChecks.length > 0) {
  printReport({
    status: "failed",
    platform: process.platform,
    executionMode: "execute-requested",
    approvalGate: approvalGate(true),
    selectedChecks: options.checks,
    error: `Unknown check id(s): ${invalidChecks.join(", ")}`,
    validCheckIDs: [...validCheckIDs],
    sideEffects: noSideEffects()
  });
  process.exit(1);
}

const results = [];
const sideEffects = noSideEffects();
let failed = false;

for (const checkID of options.checks) {
  try {
    const result = await runCheck(checkID, options);
    results.push({ id: checkID, status: "passed", ...result });
    mergeSideEffects(sideEffects, result.sideEffects);
  } catch (error) {
    failed = true;
    results.push({ id: checkID, status: "failed", error: errorMessage(error) });
  }
}

printReport({
  status: failed ? "failed" : "passed",
  platform: process.platform,
  executionMode: "approved-execution",
  approvalGate: approvalGate(true),
  selectedChecks: options.checks,
  checks: results,
  sideEffects
});

if (failed) {
  process.exit(1);
}

async function runCheck(checkID, runOptions) {
  switch (checkID) {
    case "settings-write":
      return runSettingsWriteCheck();
    case "oauth-browser-login":
      return runOAuthBrowserLoginCheck(runOptions);
    case "codex-launch":
      return runCodexLaunchCheck(runOptions);
    case "editor-restart":
      return runEditorRestartCheck(runOptions);
    case "login-item":
      return runLoginItemCheck(runOptions);
    default:
      throw new Error(`Unknown check id: ${checkID}`);
  }
}

async function runSettingsWriteCheck() {
  const { SettingsFileRepository, SettingsCoordinator } = loadDesktopModules();
  const paths = macOSPaths();
  const settingsPath = paths.settingsStorePath;
  const originalBytes = await readFileIfExists(settingsPath);
  const backup = await createSettingsBackup(settingsPath, originalBytes);
  const launchAtStartupRecorder = createRecordingLaunchAtStartupService();
  const settingsRepository = new SettingsFileRepository(paths);
  const settingsCoordinator = new SettingsCoordinator(settingsRepository, launchAtStartupRecorder);

  try {
    const before = await settingsRepository.loadSettings();
    const toggledValue = !before.autoSmartSwitch;
    await settingsCoordinator.updateSettings({ autoSmartSwitch: toggledValue });
    const changed = await settingsRepository.loadSettings();
    if (changed.autoSmartSwitch !== toggledValue) {
      throw new Error("Settings write did not persist the toggled autoSmartSwitch value");
    }

    await restoreFile(settingsPath, originalBytes);
    const restoredBytes = await readFileIfExists(settingsPath);
    if (!buffersEqual(originalBytes, restoredBytes)) {
      throw new Error("Settings file was not restored to its original bytes");
    }

    return {
      changedSetting: "autoSmartSwitch",
      originalValue: before.autoSmartSwitch,
      toggledValue,
      settingsBackupPath: backup.path,
      settingsBackupType: backup.type,
      restoredExactFile: true,
      launchAtStartupCalls: launchAtStartupRecorder.setEnabledValues,
      sideEffects: {
        writes: true
      }
    };
  } catch (error) {
    await restoreFile(settingsPath, originalBytes);
    throw error;
  }
}

async function runOAuthBrowserLoginCheck(runOptions) {
  const {
    AccountsCoordinator,
    AccountsStoreRepository,
    AuthFileRepository,
    OpenAIChatGPTOAuthLoginService,
    SettingsFileRepository
  } = loadDesktopModules();
  const paths = macOSPaths();
  const accountStoreOriginal = await readFileIfExists(paths.accountStorePath);
  const accountStoreBackup = await createAccountStoreBackup(paths.accountStorePath, accountStoreOriginal);
  const storeRepository = new AccountsStoreRepository(paths);
  const settingsRepository = new SettingsFileRepository(paths);
  const authRepository = new AuthFileRepository(paths);
  const oauthService = new OpenAIChatGPTOAuthLoginService(paths, {
    openExternal: (url) => openURLWithSystemBrowser(url),
    localeProvider: async () => (await settingsRepository.loadSettings()).locale
  });
  const accountsCoordinator = new AccountsCoordinator({
    authRepository,
    chatGPTOAuthLoginService: oauthService,
    settingsRepository,
    sourceDeviceID: "macos-real-side-effects",
    storeRepository
  });

  let account;
  let restoredAccountStore = false;
  try {
    account = await accountsCoordinator.addAccountViaLogin(
      runOptions.oauthLabel ?? "OAuth verification account",
      runOptions.oauthTimeoutSeconds
    );
  } finally {
    if (runOptions.restoreAfterOAuth) {
      await restoreFile(paths.accountStorePath, accountStoreOriginal);
      const restoredBytes = await readFileIfExists(paths.accountStorePath);
      if (!buffersEqual(accountStoreOriginal, restoredBytes)) {
        throw new Error("Account store file was not restored to its original bytes");
      }
      restoredAccountStore = true;
    }
  }

  return {
    importedAccount: {
      hasAccountId: Boolean(account.accountId),
      hasEmail: Boolean(account.email),
      isCurrent: account.isCurrent,
      planType: account.planType
    },
    accountStoreBackupPath: accountStoreBackup.path,
    accountStoreBackupType: accountStoreBackup.type,
    restoredAccountStore,
    sideEffects: {
      oauthStarted: true,
      writes: true
    }
  };
}

async function runCodexLaunchCheck(runOptions) {
  const { MacOSCodexCLIService } = loadDesktopModules();
  const service = new MacOSCodexCLIService({ environment: process.env });
  const usedFallbackCLI = await service.launchApp(runOptions.workspacePath);
  return {
    workspacePath: runOptions.workspacePath,
    usedFallbackCLI,
    sideEffects: {
      codexLaunched: true
    }
  };
}

async function runEditorRestartCheck(runOptions) {
  const { MacOSEditorAppService } = loadDesktopModules();
  if (runOptions.editors.length === 0) {
    throw new Error("Pass one or more --editor values to restart real installed editors.");
  }

  const service = new MacOSEditorAppService({ environment: process.env });
  const installed = service.listInstalledApps();
  const installedIDs = new Set(installed.map((editor) => editor.id));
  const missing = runOptions.editors.filter((editor) => !installedIDs.has(editor));
  if (missing.length > 0) {
    throw new Error(`Editor target(s) are not installed or unsupported: ${missing.join(", ")}`);
  }

  const restart = await service.restartSelectedApps(runOptions.editors);
  if (restart.error) {
    throw new Error(restart.error);
  }
  return {
    installedEditorIDs: installed.map((editor) => editor.id),
    requestedEditorIDs: runOptions.editors,
    restartedEditorIDs: restart.restarted,
    sideEffects: {
      editorsRestarted: restart.restarted.length > 0
    }
  };
}

async function runLoginItemCheck(runOptions) {
  const targetPath = runOptions.loginItemPath ?? defaultPackagedAppExecutablePath();
  if (!targetPath || !existsSync(targetPath)) {
    throw new Error("Pass --login-item-path with a packaged CodexManager app executable path.");
  }

  const electronExecutable = require("electron");
  if (typeof electronExecutable !== "string") {
    throw new Error("Could not resolve the Electron executable for the login-item helper");
  }

  const helperRoot = await mkdtemp(join(tmpdir(), "codexmanager-login-item-helper."));
  const helperPath = join(helperRoot, "login-item-helper.cjs");
  await writeFile(helperPath, loginItemHelperSource(), "utf8");
  try {
    const output = await runBoundedCommand(electronExecutable, [helperPath, targetPath], {
      timeoutMs: 10_000
    });
    const result = JSON.parse(output.stdout);
    if (!result.toggled || !result.restored) {
      throw new Error(`Login item state did not toggle and restore cleanly: ${JSON.stringify(result)}`);
    }
    return {
      targetPath,
      beforeOpenAtLogin: Boolean(result.beforeOpenAtLogin),
      afterOpenAtLogin: Boolean(result.afterOpenAtLogin),
      restoredOpenAtLogin: Boolean(result.restoredOpenAtLogin),
      sideEffects: {
        loginItemsChanged: true
      }
    };
  } finally {
    await rm(helperRoot, { force: true, recursive: true });
  }
}

function loadDesktopModules() {
  return {
    AccountsCoordinator: require("../dist/main/services/accounts-coordinator.js").AccountsCoordinator,
    AccountsStoreRepository: require("../dist/main/repositories/accounts-store-repository.js").AccountsStoreRepository,
    AuthFileRepository: require("../dist/main/repositories/auth-repository.js").AuthFileRepository,
    MacOSCodexCLIService: require("../dist/main/platform/macos/codex-cli-service.js").MacOSCodexCLIService,
    MacOSEditorAppService: require("../dist/main/platform/macos/editor-app-service.js").MacOSEditorAppService,
    OpenAIChatGPTOAuthLoginService:
      require("../dist/main/services/oauth/openai-chatgpt-oauth-service.js").OpenAIChatGPTOAuthLoginService,
    SettingsCoordinator: require("../dist/main/services/settings-coordinator.js").SettingsCoordinator,
    SettingsFileRepository: require("../dist/main/repositories/settings-repository.js").SettingsFileRepository
  };
}

function macOSPaths() {
  const home = homedir();
  return {
    applicationSupportDirectory: posix.join(home, "Library", "Application Support", "CodexManager"),
    accountStorePath: posix.join(home, "Library", "Application Support", "CodexManager", "accounts.json"),
    settingsStorePath: posix.join(home, "Library", "Application Support", "CodexManager", "settings.json"),
    codexAuthPath: posix.join(home, ".codex", "auth.json"),
    codexConfigPath: posix.join(home, ".codex", "config.toml")
  };
}

function parseOptions(args) {
  const parsed = {
    checks: [],
    editors: [],
    execute: false,
    json: args.includes("--json"),
    oauthLabel: undefined,
    oauthTimeoutSeconds: 10 * 60,
    restoreAfterOAuth: false,
    loginItemPath: undefined,
    workspacePath: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      continue;
    }
    if (arg === "--execute") {
      parsed.execute = true;
      continue;
    }
    if (arg === "--restore-after-oauth") {
      parsed.restoreAfterOAuth = true;
      continue;
    }
    if (arg === "--check") {
      parsed.checks.push(requiredValue(args, ++index, "--check"));
      continue;
    }
    if (arg.startsWith("--check=")) {
      parsed.checks.push(arg.slice("--check=".length));
      continue;
    }
    if (arg === "--editor") {
      parsed.editors.push(requiredValue(args, ++index, "--editor"));
      continue;
    }
    if (arg.startsWith("--editor=")) {
      parsed.editors.push(arg.slice("--editor=".length));
      continue;
    }
    if (arg === "--login-item-path") {
      parsed.loginItemPath = requiredValue(args, ++index, "--login-item-path");
      continue;
    }
    if (arg.startsWith("--login-item-path=")) {
      parsed.loginItemPath = arg.slice("--login-item-path=".length);
      continue;
    }
    if (arg === "--workspace") {
      parsed.workspacePath = requiredValue(args, ++index, "--workspace");
      continue;
    }
    if (arg.startsWith("--workspace=")) {
      parsed.workspacePath = arg.slice("--workspace=".length);
      continue;
    }
    if (arg === "--oauth-label") {
      parsed.oauthLabel = requiredValue(args, ++index, "--oauth-label");
      continue;
    }
    if (arg.startsWith("--oauth-label=")) {
      parsed.oauthLabel = arg.slice("--oauth-label=".length);
      continue;
    }
    if (arg === "--oauth-timeout-seconds") {
      parsed.oauthTimeoutSeconds = parsePositiveInteger(requiredValue(args, ++index, "--oauth-timeout-seconds"));
      continue;
    }
    if (arg.startsWith("--oauth-timeout-seconds=")) {
      parsed.oauthTimeoutSeconds = parsePositiveInteger(arg.slice("--oauth-timeout-seconds=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  parsed.checks = [...new Set(parsed.checks)];
  parsed.editors = [...new Set(parsed.editors)];
  return parsed;
}

function createRecordingLaunchAtStartupService() {
  return {
    setEnabledValues: [],
    setEnabled(enabled) {
      this.setEnabledValues.push(enabled);
    },
    syncWithStoreValue(enabled) {
      this.setEnabledValues.push(enabled);
    }
  };
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  return parsed;
}

function approvalGate(currentlySet) {
  return {
    required: true,
    env: approvalEnvName,
    acceptedValue: approvalEnvValue,
    currentlySet
  };
}

function noSideEffects() {
  return {
    writes: false,
    codexLaunched: false,
    editorsRestarted: false,
    loginItemsChanged: false,
    oauthStarted: false
  };
}

function mergeSideEffects(target, source = {}) {
  for (const key of Object.keys(target)) {
    target[key] = Boolean(target[key] || source[key]);
  }
}

async function readFileIfExists(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function restoreFile(filePath, originalBytes) {
  if (originalBytes === undefined) {
    await rm(filePath, { force: true });
    return;
  }
  await writeFile(filePath, originalBytes);
}

async function createSettingsBackup(settingsPath, originalBytes) {
  return createSensitiveFileBackup({
    absentFileName: "settings.json.absent",
    absentType: "absent-marker",
    backupFileName: "settings.json.backup",
    pathLabel: "settings file",
    prefix: "codexmanager-settings-backup.",
    presentType: "settings-json",
    sourcePath: settingsPath
  }, originalBytes);
}

async function createAccountStoreBackup(accountStorePath, originalBytes) {
  return createSensitiveFileBackup({
    absentFileName: "accounts.json.absent",
    absentType: "absent-marker",
    backupFileName: "accounts.json.backup",
    pathLabel: "account store file",
    prefix: "codexmanager-oauth-account-store-backup.",
    presentType: "accounts-json",
    sourcePath: accountStorePath
  }, originalBytes);
}

async function createSensitiveFileBackup(options, originalBytes) {
  const backupRoot = await mkdtemp(join(tmpdir(), options.prefix));
  if (originalBytes === undefined) {
    const markerPath = join(backupRoot, options.absentFileName);
    await writeFile(markerPath, `No ${options.pathLabel} existed at ${options.sourcePath} before verification.\n`, {
      mode: 0o600
    });
    return {
      path: markerPath,
      type: options.absentType
    };
  }

  const backupPath = join(backupRoot, options.backupFileName);
  await writeFile(backupPath, originalBytes, { mode: 0o600 });
  return {
    path: backupPath,
    type: options.presentType
  };
}

function buffersEqual(left, right) {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.equals(right);
}

async function runBoundedCommand(command, args, { timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timedOut = false;
    let forceKillTimeout;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), 2_000);
      forceKillTimeout.unref();
    }, timeoutMs);

    const settle = (operation) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      operation();
    };

    child.on("error", (error) => {
      settle(() => reject(error));
    });
    child.on("close", (code, signal) => {
      settle(() => {
        const result = {
          code,
          signal,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8")
        };
        if (timedOut) {
          reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
          return;
        }
        if (code === 0) {
          resolve(result);
        } else {
          reject(new Error(`Command failed (${code ?? signal}): ${result.stderr || result.stdout}`));
        }
      });
    });

    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
  });
}

async function openURLWithSystemBrowser(url) {
  await runBoundedCommand("open", [url], { timeoutMs: 10_000 });
  return true;
}

function appendBounded(previous, chunk) {
  const next = Buffer.concat([previous, Buffer.from(chunk)]);
  return next.byteLength <= maxCommandOutputBytes ? next : next.subarray(next.byteLength - maxCommandOutputBytes);
}

function defaultPackagedAppExecutablePath() {
  const electronArch = arch() === "arm64" ? "arm64" : "x64";
  return join(process.cwd(), "out", `CodexManager-darwin-${electronArch}`, "CodexManager.app", "Contents", "MacOS", "CodexManager");
}

function loginItemHelperSource() {
  return `
const { app } = require("electron");

const targetPath = process.argv[2];

app.whenReady().then(async () => {
  const options = targetPath ? { path: targetPath } : undefined;
  const before = app.getLoginItemSettings(options);
  const target = targetPath ? { path: targetPath } : {};
  const nextOpenAtLogin = !before.openAtLogin;
  app.setLoginItemSettings({ ...target, openAtLogin: nextOpenAtLogin, enabled: nextOpenAtLogin });
  const after = app.getLoginItemSettings(options);
  app.setLoginItemSettings({ ...target, openAtLogin: before.openAtLogin, enabled: before.openAtLogin });
  const restored = app.getLoginItemSettings(options);
  process.stdout.write(JSON.stringify({
    beforeOpenAtLogin: before.openAtLogin,
    afterOpenAtLogin: after.openAtLogin,
    restoredOpenAtLogin: restored.openAtLogin,
    toggled: after.openAtLogin === nextOpenAtLogin,
    restored: restored.openAtLogin === before.openAtLogin
  }));
  app.quit();
}).catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  app.exit(1);
});
`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error) {
  return error instanceof Error && "code" in error;
}

function printReport(value) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${formatReport(value)}\n`);
}

function formatReport(value) {
  if (value.status === "approval-required") {
    return [
      "macOS real side-effect verifier",
      "",
      "Mode: dry-run-verifier",
      `Approval gate: ${approvalEnvName}=${approvalEnvValue}`,
      "No writes, launches, OAuth browser flow, editor restarts, or login-item changes were performed.",
      "",
      "To execute a check, pass --execute, one or more --check values, and the approval environment variable."
    ].join("\n");
  }
  return JSON.stringify(value, null, 2);
}
