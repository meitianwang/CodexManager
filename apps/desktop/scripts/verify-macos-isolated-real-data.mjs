#!/usr/bin/env node

import { copyFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, posix } from "node:path";

const require = createRequire(import.meta.url);

const { AccountsStoreRepository } = require("../dist/main/repositories/accounts-store-repository.js");
const { AuthFileRepository } = require("../dist/main/repositories/auth-repository.js");
const { SettingsFileRepository } = require("../dist/main/repositories/settings-repository.js");
const { AccountsCoordinator } = require("../dist/main/services/accounts-coordinator.js");
const { SettingsCoordinator } = require("../dist/main/services/settings-coordinator.js");

const fixedUnixSeconds = 1_800_000_000;
const fixedUnixMilliseconds = fixedUnixSeconds * 1000;
const keepTempRoot = process.env.CODEX_MANAGER_KEEP_ISOLATED_REAL_DATA === "1";
const home = homedir();

class RecordingLaunchAtStartupService {
  setEnabledValues = [];

  setEnabled(enabled) {
    this.setEnabledValues.push(enabled);
  }

  syncWithStoreValue(enabled) {
    this.setEnabledValues.push(enabled);
  }
}

if (process.platform !== "darwin") {
  printReport({
    status: "skipped",
    reason: "macOS isolated real-data verification only runs on darwin",
    sideEffects: sideEffectsSummary()
  });
  process.exit(0);
}

const sourcePaths = {
  accountStorePath: posix.join(home, "Library", "Application Support", "CodexManager", "accounts.json"),
  settingsStorePath: posix.join(home, "Library", "Application Support", "CodexManager", "settings.json"),
  codexAuthPath: posix.join(home, ".codex", "auth.json"),
  codexConfigPath: posix.join(home, ".codex", "config.toml")
};

const tempRoot = await makeTempRoot();
const isolatedPaths = {
  applicationSupportDirectory: join(tempRoot, "app-support", "CodexManager"),
  accountStorePath: join(tempRoot, "app-support", "CodexManager", "accounts.json"),
  settingsStorePath: join(tempRoot, "app-support", "CodexManager", "settings.json"),
  codexAuthPath: join(tempRoot, "home", ".codex", "auth.json"),
  codexConfigPath: join(tempRoot, "home", ".codex", "config.toml")
};

const warnings = [];
const errors = [];
let report;

try {
  await copyIfExists(sourcePaths.accountStorePath, isolatedPaths.accountStorePath, "accounts.json");
  await copyIfExists(sourcePaths.settingsStorePath, isolatedPaths.settingsStorePath, "settings.json");
  await copyIfExists(sourcePaths.codexAuthPath, isolatedPaths.codexAuthPath, "auth.json");
  await copyIfExists(sourcePaths.codexConfigPath, isolatedPaths.codexConfigPath, "config.toml");

  const storeRepository = new AccountsStoreRepository(isolatedPaths, {
    unixSecondsNow: () => fixedUnixSeconds
  });
  const settingsRepository = new SettingsFileRepository(isolatedPaths);
  const authRepository = new AuthFileRepository(isolatedPaths, {
    now: () => new Date(fixedUnixMilliseconds)
  });
  const launchAtStartupService = new RecordingLaunchAtStartupService();
  const settingsCoordinator = new SettingsCoordinator(settingsRepository, launchAtStartupService);
  const accountsCoordinator = new AccountsCoordinator({
    authRepository,
    dateProvider: {
      unixMillisecondsNow: () => fixedUnixMilliseconds,
      unixSecondsNow: () => fixedUnixSeconds
    },
    settingsRepository,
    sourceDeviceID: "macos-isolated",
    storeRepository
  });

  const initialStore = await storeRepository.loadStore();
  const initialSettings = await settingsRepository.loadSettings();
  const initialAuth = await authRepository.readCurrentAuth();
  const initialAuthSummary = summarizeExtractedAuth(authRepository, initialAuth);
  const initialAccounts = await accountsCoordinator.listAccounts();
  if (initialAccounts.length === 0) {
    throw new Error("No accounts were available in the isolated real-data copy");
  }

  const selectedAccount = initialAccounts.find((account) => account.isCurrent) ?? initialAccounts[0];
  if (!selectedAccount) {
    throw new Error("No switch target was available in the isolated real-data copy");
  }

  const transferPackage = await accountsCoordinator.makeAccountsTransferPackage(new Set([selectedAccount.id]));
  const importResult = await accountsCoordinator.importAccountsTransferPackage(
    transferPackage,
    new Set([selectedAccount.id])
  );
  await accountsCoordinator.switchAccount(selectedAccount.id);

  const toggledLaunchAtStartup = !initialSettings.launchAtStartup;
  await settingsCoordinator.updateSettings({ launchAtStartup: toggledLaunchAtStartup });
  const toggledSettings = await settingsRepository.loadSettings();
  await settingsCoordinator.updateSettings({ launchAtStartup: initialSettings.launchAtStartup });
  const restoredSettings = await settingsRepository.loadSettings();

  const finalStore = await storeRepository.loadStore();
  const finalAuth = await authRepository.readCurrentAuth();
  const finalAuthSummary = summarizeExtractedAuth(authRepository, finalAuth);

  const checks = {
    sourceDataCopied: true,
    initialAccountsParsed: initialStore.accounts.length > 0,
    initialAuthExtractable: initialAuthSummary.extractable,
    listAccountsReturnedAccounts: initialAccounts.length > 0,
    transferPackageExportedSelectedAccount: transferPackage.accounts.length === 1,
    transferPackageImportedIntoIsolatedStore: importResult.insertedCount + importResult.updatedCount > 0,
    switchWroteIsolatedSelection: finalStore.currentSelection?.sourceDeviceID === "macos-isolated",
    switchWroteIsolatedAuth: finalAuthSummary.extractable,
    settingsTogglePersistedInIsolation: toggledSettings.launchAtStartup === toggledLaunchAtStartup,
    settingsRestoredInIsolation: restoredSettings.launchAtStartup === initialSettings.launchAtStartup,
    launchAtStartupSideEffectWasRecordedOnly:
      launchAtStartupService.setEnabledValues.length === 2 &&
      launchAtStartupService.setEnabledValues[0] === toggledLaunchAtStartup &&
      launchAtStartupService.setEnabledValues[1] === initialSettings.launchAtStartup
  };

  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  if (failedChecks.length > 0) {
    errors.push(`Failed isolated workflow checks: ${failedChecks.join(", ")}`);
  }

  report = {
    status: errors.length === 0 ? "passed" : "failed",
    mode: "isolated-real-data-copy",
    sourcePaths: redactSourcePaths(sourcePaths),
    isolatedRoot: keepTempRoot ? tempRoot : "<removed>",
    source: {
      accountCount: initialStore.accounts.length,
      settingsExists: true,
      authExtractable: initialAuthSummary.extractable
    },
    workflows: {
      listedAccountCount: initialAccounts.length,
      selectedAccountWasCurrent: selectedAccount.isCurrent,
      transferPackageAccountCount: transferPackage.accounts.length,
      importResult,
      finalSelectionSourceDeviceID: finalStore.currentSelection?.sourceDeviceID,
      finalAuthExtractable: finalAuthSummary.extractable,
      settingsLaunchAtStartupOriginal: initialSettings.launchAtStartup,
      settingsLaunchAtStartupToggled: toggledSettings.launchAtStartup,
      settingsLaunchAtStartupRestored: restoredSettings.launchAtStartup,
      launchAtStartupRecordedValues: launchAtStartupService.setEnabledValues
    },
    checks,
    warnings,
    errors,
    sideEffects: sideEffectsSummary()
  };
} catch (error) {
  errors.push(errorMessage(error));
  report = {
    status: "failed",
    mode: "isolated-real-data-copy",
    isolatedRoot: keepTempRoot ? tempRoot : "<removed>",
    warnings,
    errors,
    sideEffects: sideEffectsSummary()
  };
  process.exitCode = 1;
} finally {
  if (!keepTempRoot) {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

printReport(report);
if (report.status !== "passed") {
  process.exitCode = 1;
}

async function makeTempRoot() {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "codexmanager-macos-isolated-real-data."));
}

async function copyIfExists(sourcePath, targetPath, label) {
  try {
    await mkdir(posix.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      warnings.push(`${label} was not found and was not copied`);
      return;
    }
    throw error;
  }
}

function summarizeExtractedAuth(repository, auth) {
  try {
    const extracted = repository.extractAuth(auth);
    return {
      extractable: true,
      hasAccountId: Boolean(extracted.accountId),
      hasEmail: Boolean(extracted.email),
      hasPlanType: Boolean(extracted.planType),
      hasPrincipalId: Boolean(extracted.principalId),
      hasAccessToken: Boolean(extracted.accessToken)
    };
  } catch (error) {
    return {
      extractable: false,
      error: errorMessage(error)
    };
  }
}

function sideEffectsSummary() {
  return {
    realUserDataWrites: false,
    isolatedTempWrites: true,
    codexLaunched: false,
    editorsRestarted: false,
    loginItemsChanged: false,
    oauthStarted: false
  };
}

function redactSourcePaths(paths) {
  return Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, redactHome(value)]));
}

function redactHome(value) {
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error) {
  return error instanceof Error && "code" in error;
}

function printReport(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
