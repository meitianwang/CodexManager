#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { posix } from "node:path";

const require = createRequire(import.meta.url);

const { parseJsonValue } = require("../dist/shared/models/json-value.js");
const {
  parseAccountsStore,
  parseAppSettings,
  parseLegacyAccountsStore
} = require("../dist/main/repositories/store-parsers.js");
const { AuthFileRepository } = require("../dist/main/repositories/auth-repository.js");
const { MacOSCodexCLIService } = require("../dist/main/platform/macos/codex-cli-service.js");
const { MacOSEditorAppService } = require("../dist/main/platform/macos/editor-app-service.js");

const home = homedir();
const paths = {
  applicationSupportDirectory: posix.join(home, "Library", "Application Support", "CodexManager"),
  accountStorePath: posix.join(home, "Library", "Application Support", "CodexManager", "accounts.json"),
  settingsStorePath: posix.join(home, "Library", "Application Support", "CodexManager", "settings.json"),
  codexAuthPath: posix.join(home, ".codex", "auth.json"),
  codexConfigPath: posix.join(home, ".codex", "config.toml")
};

if (process.platform !== "darwin") {
  printReport({
    status: "skipped",
    reason: "macOS real-data verification only runs on darwin",
    sideEffects: sideEffectsSummary()
  });
  process.exit(0);
}

const errors = [];
const warnings = [];

const accountStore = await inspectAccountsStore(paths.accountStorePath);
const settingsStore = await inspectSettingsStore(paths.settingsStorePath, accountStore.legacySettings);
const auth = await inspectCodexAuth(paths.codexAuthPath);
const codex = await inspectCodexInstall();
const editors = inspectInstalledEditors();

if (accountStore.error) {
  errors.push(`accounts.json: ${accountStore.error}`);
}
if (settingsStore.error) {
  errors.push(`settings.json: ${settingsStore.error}`);
}
if (auth.error) {
  errors.push(`auth.json: ${auth.error}`);
}
if (codex.error) {
  warnings.push(`Codex app/CLI probe: ${codex.error}`);
}
if (editors.error) {
  warnings.push(`Editor app probe: ${editors.error}`);
}

if (!accountStore.exists) {
  warnings.push("CodexManager account store was not found");
}
if (!auth.exists) {
  warnings.push("Codex auth.json was not found");
}
if (!codex.cli.found) {
  warnings.push("Codex CLI was not found");
}
if (!codex.app.found) {
  warnings.push("Codex desktop app was not found");
}
if (editors.count === 0) {
  warnings.push("No supported editor app installation was detected");
}

printReport({
  status: errors.length === 0 ? "passed" : "failed",
  paths: {
    applicationSupportDirectory: redactHome(paths.applicationSupportDirectory),
    applicationSupportDirectoryExists: isDirectory(paths.applicationSupportDirectory),
    accountStorePath: redactHome(paths.accountStorePath),
    accountStorePathExists: accountStore.exists,
    settingsStorePath: redactHome(paths.settingsStorePath),
    settingsStorePathExists: settingsStore.exists,
    codexAuthPath: redactHome(paths.codexAuthPath),
    codexAuthPathExists: auth.exists,
    codexConfigPath: redactHome(paths.codexConfigPath),
    codexConfigPathExists: existsSync(paths.codexConfigPath)
  },
  accounts: withoutInternalFields(accountStore),
  settings: settingsStore,
  auth,
  codex,
  editors,
  readiness: {
    accountStoreUsable: accountStore.exists && accountStore.parsed,
    settingsUsable: settingsStore.exists ? settingsStore.parsed : settingsStore.loadedFromLegacyAccounts,
    codexAuthExtractable: auth.exists && auth.extractable,
    codexCLIAvailable: codex.cli.found,
    codexDesktopAppAvailable: codex.app.found,
    editorRestartTargetsAvailable: editors.count > 0
  },
  warnings,
  errors,
  sideEffects: sideEffectsSummary()
});

if (errors.length > 0) {
  process.exitCode = 1;
}

async function inspectAccountsStore(filePath) {
  const file = await readJsonIfExists(filePath, "accounts.json");
  if (!file.exists) {
    return {
      exists: false,
      parsed: false,
      count: 0,
      hasCurrentSelection: false
    };
  }
  if (file.error) {
    return {
      exists: true,
      parsed: false,
      count: 0,
      hasCurrentSelection: false,
      error: file.error
    };
  }

  try {
    const store = parseAccountsStore(file.value);
    return {
      exists: true,
      parsed: true,
      count: store.accounts.length,
      hasCurrentSelection: Boolean(store.currentSelection),
      currentSelectionHasAccountKey: Boolean(store.currentSelection?.accountKey),
      legacySettings: inspectLegacySettings(file.value)
    };
  } catch (error) {
    return {
      exists: true,
      parsed: false,
      count: 0,
      hasCurrentSelection: false,
      error: safeError(error)
    };
  }
}

function inspectLegacySettings(value) {
  try {
    const legacyStore = parseLegacyAccountsStore(value);
    return {
      exists: true,
      parsed: true,
      summary: summarizeSettings(legacyStore.settings)
    };
  } catch {
    return {
      exists: false,
      parsed: false
    };
  }
}

async function inspectSettingsStore(filePath, legacySettings) {
  const file = await readJsonIfExists(filePath, "settings.json");
  if (!file.exists) {
    return {
      exists: false,
      parsed: false,
      loadedFromLegacyAccounts: Boolean(legacySettings?.parsed),
      legacyAccountsSettings: legacySettings?.summary
    };
  }
  if (file.error) {
    return {
      exists: true,
      parsed: false,
      loadedFromLegacyAccounts: false,
      error: file.error
    };
  }

  try {
    const settings = parseAppSettings(file.value);
    return {
      exists: true,
      parsed: true,
      loadedFromLegacyAccounts: false,
      ...summarizeSettings(settings)
    };
  } catch (error) {
    return {
      exists: true,
      parsed: false,
      loadedFromLegacyAccounts: false,
      error: safeError(error)
    };
  }
}

async function inspectCodexAuth(filePath) {
  const file = await readJsonIfExists(filePath, "auth.json");
  if (!file.exists) {
    return {
      exists: false,
      jsonParsed: false,
      extractable: false
    };
  }
  if (file.error) {
    return {
      exists: true,
      jsonParsed: false,
      extractable: false,
      error: file.error
    };
  }

  try {
    const repository = new AuthFileRepository({ codexAuthPath: filePath });
    const authJson = parseJsonValue(file.value, "auth JSON");
    const extracted = repository.extractAuth(authJson);
    return {
      exists: true,
      jsonParsed: true,
      extractable: true,
      hasAccountId: Boolean(extracted.accountId),
      hasEmail: Boolean(extracted.email),
      hasPlanType: Boolean(extracted.planType),
      hasTeamName: Boolean(extracted.teamName),
      hasPrincipalId: Boolean(extracted.principalId),
      hasAccessToken: Boolean(extracted.accessToken)
    };
  } catch (error) {
    return {
      exists: true,
      jsonParsed: true,
      extractable: false,
      error: safeError(error)
    };
  }
}

async function inspectCodexInstall() {
  const service = new MacOSCodexCLIService({ environment: process.env });
  const result = {
    cli: {
      found: false
    },
    app: {
      found: false
    }
  };

  try {
    const cliPath = service.findCodexCLIPath();
    result.cli = {
      found: true,
      path: redactHome(cliPath)
    };
  } catch (error) {
    result.cli = {
      found: false,
      error: safeError(error)
    };
  }

  try {
    const appPath = await service.findCodexAppPath();
    result.app = appPath
      ? {
          found: true,
          path: redactHome(appPath)
        }
      : {
          found: false
        };
  } catch (error) {
    result.app = {
      found: false,
      error: safeError(error)
    };
  }

  return result;
}

function inspectInstalledEditors() {
  try {
    const service = new MacOSEditorAppService({ environment: process.env });
    const installed = service.listInstalledApps();
    return {
      count: installed.length,
      ids: installed.map((app) => app.id).sort()
    };
  } catch (error) {
    return {
      count: 0,
      ids: [],
      error: safeError(error)
    };
  }
}

async function readJsonIfExists(filePath, label) {
  try {
    const raw = await readFile(filePath, "utf8");
    return {
      exists: true,
      value: JSON.parse(raw)
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        exists: false
      };
    }
    return {
      exists: true,
      error: `${label} could not be read or parsed: ${safeError(error)}`
    };
  }
}

function summarizeSettings(settings) {
  return {
    locale: settings.locale,
    launchAtStartup: settings.launchAtStartup,
    launchCodexAfterSwitch: settings.launchCodexAfterSwitch,
    autoSmartSwitch: settings.autoSmartSwitch,
    restartEditorsOnSwitch: settings.restartEditorsOnSwitch,
    restartEditorTargetCount: settings.restartEditorTargets.length,
    proxyPort: settings.proxyPort,
    hasProxyApiKey: Boolean(settings.proxyApiKey),
    autoStartProxy: settings.autoStartProxy
  };
}

function sideEffectsSummary() {
  return {
    writes: false,
    codexLaunched: false,
    editorsRestarted: false,
    loginItemsChanged: false,
    oauthStarted: false
  };
}

function withoutInternalFields(accountStore) {
  const { legacySettings: _legacySettings, ...publicSummary } = accountStore;
  return publicSummary;
}

function isDirectory(filePath) {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function redactHome(value) {
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function isNodeError(error) {
  return error instanceof Error && "code" in error;
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function printReport(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
