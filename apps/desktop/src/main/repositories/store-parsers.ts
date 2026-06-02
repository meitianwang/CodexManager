import type { AccountsStore, CurrentAccountSelection, StoredAccount } from "../../shared/models/accounts";
import { emptyAccountsStore } from "../../shared/models/accounts";
import type { AccountsTransferPackage } from "../../shared/models/account-transfer";
import type { AppSettings, EditorAppID } from "../../shared/models/settings";
import { defaultAppSettings, isEditorAppID, resolveAppLocale } from "../../shared/models/settings";
import type { UsageSnapshot } from "../../shared/models/usage";
import { parseJsonValue } from "../../shared/models/json-value";

export interface LegacyAccountsStore extends AccountsStore {
  settings: AppSettings;
}

export function parseAccountsStore(value: unknown): AccountsStore {
  const object = asRecord(value, "accounts store");
  return {
    version: readInteger(object, "version"),
    accounts: readArray(object, "accounts").map(parseStoredAccount),
    currentSelection: optionalObject(object, "currentSelection", parseCurrentAccountSelection)
  };
}

export function parseLegacyAccountsStore(value: unknown): LegacyAccountsStore {
  const object = asRecord(value, "legacy accounts store");
  return {
    ...parseAccountsStore(value),
    settings: parseAppSettings(readRequired(object, "settings"))
  };
}

export function parseAccountsTransferPackage(value: unknown): AccountsTransferPackage {
  const object = asRecord(value, "accounts transfer package");
  return {
    format: readString(object, "format"),
    version: readInteger(object, "version"),
    exportedAt: readInteger(object, "exportedAt"),
    accounts: readArray(object, "accounts").map(parseStoredAccount)
  };
}

export function serializeAccountsStore(store: AccountsStore): AccountsStore {
  return {
    version: store.version,
    accounts: store.accounts,
    currentSelection: store.currentSelection
  };
}

export function parseAppSettings(value: unknown): AppSettings {
  const defaults = defaultAppSettings();
  const object = asRecord(value, "settings");
  return {
    launchAtStartup: optionalBoolean(object, "launchAtStartup", defaults.launchAtStartup),
    launchCodexAfterSwitch: optionalBoolean(object, "launchCodexAfterSwitch", defaults.launchCodexAfterSwitch),
    autoSmartSwitch: optionalBoolean(object, "autoSmartSwitch", defaults.autoSmartSwitch),
    restartEditorsOnSwitch: optionalBoolean(object, "restartEditorsOnSwitch", defaults.restartEditorsOnSwitch),
    restartEditorTargets: optionalEditorAppIds(object, "restartEditorTargets", defaults.restartEditorTargets),
    locale: resolveAppLocale(optionalString(object, "locale", defaults.locale)),
    proxyPort: optionalUInt16(object, "proxyPort", defaults.proxyPort),
    proxyApiKey: optionalString(object, "proxyApiKey", defaults.proxyApiKey),
    autoStartProxy: optionalBoolean(object, "autoStartProxy", defaults.autoStartProxy)
  };
}

export function serializeAppSettings(settings: AppSettings): AppSettings {
  return {
    launchAtStartup: settings.launchAtStartup,
    launchCodexAfterSwitch: settings.launchCodexAfterSwitch,
    autoSmartSwitch: settings.autoSmartSwitch,
    restartEditorsOnSwitch: settings.restartEditorsOnSwitch,
    restartEditorTargets: settings.restartEditorTargets,
    locale: resolveAppLocale(settings.locale),
    proxyPort: settings.proxyPort,
    proxyApiKey: settings.proxyApiKey,
    autoStartProxy: settings.autoStartProxy
  };
}

export function parseStoredAccount(value: unknown): StoredAccount {
  const object = asRecord(value, "stored account");
  return {
    id: readString(object, "id"),
    label: readString(object, "label"),
    email: optionalStringOrUndefined(object, "email"),
    accountId: readString(object, "accountId"),
    planType: optionalStringOrUndefined(object, "planType"),
    teamName: optionalStringOrUndefined(object, "teamName"),
    teamAlias: optionalStringOrUndefined(object, "teamAlias"),
    authJson: parseJsonValue(readRequired(object, "authJson"), "authJson"),
    addedAt: readInteger(object, "addedAt"),
    updatedAt: readInteger(object, "updatedAt"),
    usage: optionalObject(object, "usage", parseUsageSnapshot),
    usageError: optionalStringOrUndefined(object, "usageError"),
    principalId: optionalStringOrUndefined(object, "principalId")
  };
}

function parseCurrentAccountSelection(value: unknown): CurrentAccountSelection {
  const object = asRecord(value, "current account selection");
  return {
    accountId: readString(object, "accountId"),
    selectedAt: readInteger(object, "selectedAt"),
    sourceDeviceID: readString(object, "sourceDeviceID"),
    accountKey: optionalStringOrUndefined(object, "accountKey")
  };
}

function parseUsageSnapshot(value: unknown): UsageSnapshot {
  const object = asRecord(value, "usage snapshot");
  return {
    fetchedAt: readInteger(object, "fetchedAt"),
    planType: optionalStringOrUndefined(object, "planType"),
    fiveHour: optionalObject(object, "fiveHour", parseUsageWindow),
    oneWeek: optionalObject(object, "oneWeek", parseUsageWindow),
    credits: optionalObject(object, "credits", parseCreditSnapshot)
  };
}

function parseUsageWindow(value: unknown) {
  const object = asRecord(value, "usage window");
  return {
    usedPercent: readNumber(object, "usedPercent"),
    windowSeconds: readInteger(object, "windowSeconds"),
    resetAt: optionalInteger(object, "resetAt")
  };
}

function parseCreditSnapshot(value: unknown) {
  const object = asRecord(value, "credit snapshot");
  return {
    hasCredits: readBoolean(object, "hasCredits"),
    unlimited: readBoolean(object, "unlimited"),
    balance: optionalStringOrUndefined(object, "balance")
  };
}

function optionalObject<T>(object: Record<string, unknown>, key: string, parser: (value: unknown) => T): T | undefined {
  if (object[key] === undefined || object[key] === null) {
    return undefined;
  }
  return parser(object[key]);
}

function optionalString(object: Record<string, unknown>, key: string, fallback: string): string {
  if (object[key] === undefined || object[key] === null) {
    return fallback;
  }
  return readString(object, key);
}

function optionalStringOrUndefined(object: Record<string, unknown>, key: string): string | undefined {
  if (object[key] === undefined || object[key] === null) {
    return undefined;
  }
  return readString(object, key);
}

function optionalBoolean(object: Record<string, unknown>, key: string, fallback: boolean): boolean {
  if (object[key] === undefined || object[key] === null) {
    return fallback;
  }
  return readBoolean(object, key);
}

function optionalInteger(object: Record<string, unknown>, key: string): number | undefined {
  if (object[key] === undefined || object[key] === null) {
    return undefined;
  }
  return readInteger(object, key);
}

function optionalUInt16(object: Record<string, unknown>, key: string, fallback: number): number {
  if (object[key] === undefined || object[key] === null) {
    return fallback;
  }

  const value = readInteger(object, key);
  if (value < 0 || value > 65535) {
    throw new Error(`${key} must be a UInt16`);
  }
  return value;
}

function optionalEditorAppIds(object: Record<string, unknown>, key: string, fallback: EditorAppID[]): EditorAppID[] {
  if (object[key] === undefined || object[key] === null) {
    return fallback;
  }

  return readArray(object, key).map((value) => {
    if (typeof value !== "string" || !isEditorAppID(value)) {
      throw new Error(`${key} contains an unsupported editor app id`);
    }
    return value;
  });
}

function readRequired(object: Record<string, unknown>, key: string): unknown {
  if (object[key] === undefined) {
    throw new Error(`Missing required field ${key}`);
  }
  return object[key];
}

function readString(object: Record<string, unknown>, key: string): string {
  const value = readRequired(object, key);
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function readBoolean(object: Record<string, unknown>, key: string): boolean {
  const value = readRequired(object, key);
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function readNumber(object: Record<string, unknown>, key: string): number {
  const value = readRequired(object, key);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

function readInteger(object: Record<string, unknown>, key: string): number {
  const value = readNumber(object, key);
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  return value;
}

function readArray(object: Record<string, unknown>, key: string): unknown[] {
  const value = readRequired(object, key);
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array`);
  }
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseAccountsStoreOrDefault(value: unknown): AccountsStore {
  if (value === undefined || value === null) {
    return emptyAccountsStore();
  }
  return parseAccountsStore(value);
}
