#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const maxOutputBytes = 8 * 1024;
const smokeTimeoutMs = parsePositiveInteger(process.env.CODEX_MANAGER_ELECTRON_SMOKE_TIMEOUT_MS, 45_000);

if (process.platform !== "darwin") {
  printJSON({
    status: "skipped",
    reason: "macOS packaged smoke only runs on darwin"
  });
  process.exit(0);
}

const appExecutable = findPackagedAppExecutable();
const artifactRoot = await smokeArtifactRoot();
const smokeRoot = path.join(artifactRoot, "root");
const screenshotDirectory = path.join(artifactRoot, "screens");
const resultPath = path.join(artifactRoot, "smoke-result.json");
mkdirSync(screenshotDirectory, { recursive: true });

const childResult = await runPackagedSmoke(appExecutable, {
  CODEX_MANAGER_ELECTRON_SMOKE_RESULT_PATH: resultPath,
  CODEX_MANAGER_ELECTRON_SMOKE_ROOT: smokeRoot,
  CODEX_MANAGER_ELECTRON_SMOKE_SCREENSHOT_DIR: screenshotDirectory,
  CODEX_MANAGER_ELECTRON_SMOKE_TEST: "1",
  CODEX_MANAGER_ELECTRON_SMOKE_TIMEOUT_MS: String(smokeTimeoutMs)
});

const smokeResult = readSmokeResult(resultPath);
const validationErrors = validateSmokeResult(smokeResult);
const passed = childResult.exitCode === 0 && smokeResult?.status === "passed" && validationErrors.length === 0;
const summary = {
  status: passed ? "passed" : "failed",
  appExecutable: path.relative(process.cwd(), appExecutable),
  artifactRoot,
  resultPath,
  screenshotDirectory,
  exitCode: childResult.exitCode,
  signal: childResult.signal,
  timedOut: childResult.timedOut,
  validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
  stdoutTail: passed ? undefined : childResult.stdoutTail,
  stderrTail: passed ? undefined : childResult.stderrTail,
  smoke: summarizeSmokeResult(smokeResult)
};

printJSON(summary);

if (summary.status !== "passed") {
  process.exitCode = 1;
}

function findPackagedAppExecutable() {
  const outDirectory = path.join(process.cwd(), "out");
  const archPreference = process.env.CODEX_MANAGER_ELECTRON_PACKAGE_SMOKE_ARCH ?? process.arch;
  const preferredPath = packagedExecutablePath(outDirectory, archPreference);
  if (existsSync(preferredPath)) {
    return preferredPath;
  }

  const candidates = listPackagedExecutableCandidates(outDirectory);
  if (candidates.length === 0) {
    throw new Error(`No packaged CodexManager.app executable found under ${outDirectory}. Run pnpm run package:macos first.`);
  }
  return candidates[0];
}

function packagedExecutablePath(outDirectory, arch) {
  return path.join(outDirectory, `CodexManager-darwin-${arch}`, "CodexManager.app", "Contents", "MacOS", "CodexManager");
}

function listPackagedExecutableCandidates(outDirectory) {
  try {
    return readdirSync(outDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("CodexManager-darwin-"))
      .map((entry) => path.join(outDirectory, entry.name, "CodexManager.app", "Contents", "MacOS", "CodexManager"))
      .filter((candidate) => existsSync(candidate))
      .sort();
  } catch {
    return [];
  }
}

async function smokeArtifactRoot() {
  const configuredRoot = process.env.CODEX_MANAGER_ELECTRON_PACKAGE_SMOKE_ARTIFACT_DIR;
  if (configuredRoot && configuredRoot.trim().length > 0) {
    mkdirSync(configuredRoot, { recursive: true });
    return configuredRoot;
  }
  return await mkdtemp(path.join(tmpdir(), "codexmanager-macos-package-smoke."));
}

async function runPackagedSmoke(executablePath, smokeEnvironment) {
  const child = spawn(executablePath, [], {
    env: {
      ...process.env,
      ...smokeEnvironment
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdoutTail = "";
  let stderrTail = "";
  let timedOut = false;

  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });

  child.stdout?.on("data", (chunk) => {
    stdoutTail = appendBounded(stdoutTail, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderrTail = appendBounded(stderrTail, chunk);
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
  }, smokeTimeoutMs + 10_000);

  try {
    const result = await closed;
    return {
      ...result,
      stdoutTail,
      stderrTail,
      timedOut
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readSmokeResult(resultPath) {
  if (!existsSync(resultPath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(resultPath, "utf8"));
}

function validateSmokeResult(result) {
  const errors = [];
  if (!result || typeof result !== "object") {
    return ["smoke-result.json was not written or did not contain an object"];
  }
  if (result.status !== "passed") {
    errors.push(`smoke status was ${JSON.stringify(result.status)}`);
  }

  const workflows = result.workflows && typeof result.workflows === "object" ? result.workflows : undefined;
  if (!workflows) {
    errors.push("missing workflows evidence");
    return errors;
  }

  const accounts = workflows.accounts && typeof workflows.accounts === "object" ? workflows.accounts : {};
  if (accounts.exportPackageAccountCount !== 5) {
    errors.push("account export package did not include the five smoke accounts");
  }
  if (accounts.importPackageInsertedCount !== 1 || accounts.importPackageUpdatedCount !== 0) {
    errors.push("account package import did not record one inserted account and zero updated accounts");
  }
  if (accounts.oauthSignInCount < 1 || accounts.oauthAccountId !== "acct-oauth") {
    errors.push("OAuth smoke import evidence was incomplete");
  }
  if (accounts.restoredAccountCount !== 1 || accounts.smartSwitchAccountId !== "acct-package") {
    errors.push("account restore or smart-switch evidence was incomplete");
  }

  const persistence = workflows.persistence && typeof workflows.persistence === "object" ? workflows.persistence : {};
  if (!persistence.accountsJsonExists || !persistence.settingsJsonExists || !persistence.codexAuthExists) {
    errors.push("persistence evidence did not include accounts, settings, and auth files");
  }
  if (persistence.codexAuthAccountId !== "acct-smoke" || persistence.settingsLocale !== "en") {
    errors.push("persistence evidence did not preserve the expected smoke auth and settings values");
  }

  const platform = workflows.platform && typeof workflows.platform === "object" ? workflows.platform : {};
  if (
    !numberAtLeast(platform.codexLaunchCount, 1) ||
    !numberAtLeast(platform.editorRestartCount, 1) ||
    platform.usedFallbackCLI !== true
  ) {
    errors.push("platform side-effect recorder evidence was incomplete");
  }
  if (!includesBooleanSequence(asArray(platform.startupSetEnabledValues), [true, false])) {
    errors.push("launch-at-startup recorder evidence did not include enable then disable");
  }

  const proxyRoutes = workflows.proxyRoutes && typeof workflows.proxyRoutes === "object" ? workflows.proxyRoutes : {};
  if (workflows.proxyHealthOK !== true || workflows.proxyUnauthorizedStatus !== 401 || workflows.proxyWrongApiKeyStatus !== 401) {
    errors.push("proxy health or auth rejection evidence was incomplete");
  }
  for (const key of [
    "modelsStatus",
    "chatCompletionsStatus",
    "responsesStatus",
    "responsesCompactStatus",
    "memoriesTraceSummarizeStatus",
    "alphaSearchStatus",
    "messagesStatus"
  ]) {
    const status = proxyRoutes[key];
    if (typeof status !== "number" || status < 200 || status >= 300) {
      errors.push(`proxy route ${key} did not return a successful status`);
    }
  }
  if (!numberAtLeast(proxyRoutes.upstreamPathCount, 7)) {
    errors.push("proxy upstream route coverage was incomplete");
  }

  const tray = workflows.tray && typeof workflows.tray === "object" ? workflows.tray : {};
  if (
    !includesAll(asArray(tray.completedActions), [
      "showWindow",
      "refreshAccounts",
      "smartSwitch",
      "startProxy",
      "stopProxy",
      "quit"
    ]) ||
    tray.quitRequested !== true ||
    !includesBooleanSequence(asArray(tray.proxyToggleSequence), [true, false])
  ) {
    errors.push("tray workflow evidence was incomplete");
  }

  const snapshots = Array.isArray(result.uiSnapshots) ? result.uiSnapshots : [];
  const pages = snapshots.map((snapshot) => snapshot.page);
  if (!includesAll(pages, ["accounts", "proxy", "settings"])) {
    errors.push("UI snapshot evidence did not include Accounts, Proxy, and Settings");
  }
  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot !== "object") {
      errors.push("UI snapshot entry was not an object");
      continue;
    }
    if (
      typeof snapshot.screenshotPath !== "string" ||
      !existsSync(snapshot.screenshotPath) ||
      statSync(snapshot.screenshotPath).size <= 0 ||
      !numberAtLeast(snapshot.screenshotByteLength, 1) ||
      !numberAtLeast(snapshot.screenshotWidth, 1) ||
      !numberAtLeast(snapshot.screenshotHeight, 1)
    ) {
      errors.push(`UI snapshot ${JSON.stringify(snapshot.page)} did not include a valid screenshot file`);
    }
  }

  return errors;
}

function summarizeSmokeResult(result) {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const workflows = result.workflows && typeof result.workflows === "object" ? result.workflows : {};
  const accounts = workflows.accounts && typeof workflows.accounts === "object" ? workflows.accounts : {};
  const platform = workflows.platform && typeof workflows.platform === "object" ? workflows.platform : {};
  const proxyRoutes = workflows.proxyRoutes && typeof workflows.proxyRoutes === "object" ? workflows.proxyRoutes : {};
  const persistence = workflows.persistence && typeof workflows.persistence === "object" ? workflows.persistence : {};
  const tray = workflows.tray && typeof workflows.tray === "object" ? workflows.tray : {};
  const uiSnapshots = Array.isArray(result.uiSnapshots) ? result.uiSnapshots : [];

  return {
    status: result.status,
    error: typeof result.error === "string" ? result.error : undefined,
    accounts: {
      exportPackageAccountCount: accounts.exportPackageAccountCount,
      importPackageInsertedCount: accounts.importPackageInsertedCount,
      oauthSignInCount: accounts.oauthSignInCount,
      restoredAccountCount: accounts.restoredAccountCount
    },
    persistence: {
      accountsJsonExists: persistence.accountsJsonExists,
      codexAuthExists: persistence.codexAuthExists,
      settingsJsonExists: persistence.settingsJsonExists
    },
    platform: {
      codexLaunchCount: platform.codexLaunchCount,
      editorRestartCount: platform.editorRestartCount,
      startupSetEnabledValues: platform.startupSetEnabledValues,
      usedFallbackCLI: platform.usedFallbackCLI
    },
    proxy: {
      healthOK: workflows.proxyHealthOK,
      routeStatuses: {
        alphaSearchStatus: proxyRoutes.alphaSearchStatus,
        chatCompletionsStatus: proxyRoutes.chatCompletionsStatus,
        memoriesTraceSummarizeStatus: proxyRoutes.memoriesTraceSummarizeStatus,
        messagesStatus: proxyRoutes.messagesStatus,
        modelsStatus: proxyRoutes.modelsStatus,
        responsesCompactStatus: proxyRoutes.responsesCompactStatus,
        responsesStatus: proxyRoutes.responsesStatus
      },
      upstreamPathCount: proxyRoutes.upstreamPathCount
    },
    tray: {
      completedActions: tray.completedActions,
      proxyToggleSequence: tray.proxyToggleSequence,
      quitRequested: tray.quitRequested
    },
    uiSnapshots: uiSnapshots.map((snapshot) => ({
      page: snapshot.page,
      screenshotPath: snapshot.screenshotPath,
      screenshotByteLength: snapshot.screenshotByteLength,
      screenshotSize: `${snapshot.screenshotWidth ?? 0}x${snapshot.screenshotHeight ?? 0}`
    })),
    screenshotFiles: listScreenshotFiles(uiSnapshots)
  };
}

function listScreenshotFiles(uiSnapshots) {
  return uiSnapshots
    .map((snapshot) => snapshot.screenshotPath)
    .filter((screenshotPath) => typeof screenshotPath === "string" && existsSync(screenshotPath))
    .map((screenshotPath) => ({
      path: screenshotPath,
      bytes: statSync(screenshotPath).size
    }));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function includesAll(values, expectedValues) {
  return expectedValues.every((expected) => values.includes(expected));
}

function includesBooleanSequence(values, expectedSequence) {
  if (expectedSequence.length === 0) {
    return true;
  }

  let expectedIndex = 0;
  for (const value of values) {
    if (value !== expectedSequence[expectedIndex]) {
      continue;
    }
    expectedIndex += 1;
    if (expectedIndex === expectedSequence.length) {
      return true;
    }
  }
  return false;
}

function numberAtLeast(value, minimum) {
  return typeof value === "number" && value >= minimum;
}

function appendBounded(current, chunk) {
  const next = `${current}${chunk.toString("utf8")}`;
  return Buffer.byteLength(next, "utf8") > maxOutputBytes ? next.slice(-maxOutputBytes) : next;
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
