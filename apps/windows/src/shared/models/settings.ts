export const editorAppIds = [
  "vscode",
  "vscodeInsiders",
  "cursor",
  "antigravity",
  "kiro",
  "trae",
  "qoder"
] as const;

export type EditorAppID = (typeof editorAppIds)[number];

export const appLocales = [
  "en",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "ko",
  "fr",
  "de",
  "it",
  "es",
  "ru",
  "nl"
] as const;

export type AppLocaleID = (typeof appLocales)[number];

export interface AppSettings {
  launchAtStartup: boolean;
  launchCodexAfterSwitch: boolean;
  autoSmartSwitch: boolean;
  restartEditorsOnSwitch: boolean;
  restartEditorTargets: EditorAppID[];
  locale: AppLocaleID;
  proxyPort: number;
  proxyApiKey: string;
  autoStartProxy: boolean;
}

export interface AppSettingsPatch {
  launchAtStartup?: boolean;
  launchCodexAfterSwitch?: boolean;
  autoSmartSwitch?: boolean;
  restartEditorsOnSwitch?: boolean;
  restartEditorTargets?: EditorAppID[];
  locale?: string;
  proxyPort?: number;
  proxyApiKey?: string;
  autoStartProxy?: boolean;
}

export function resolveAppLocale(value: string): AppLocaleID {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.startsWith("zh-hant") ||
    normalized.startsWith("zh-tw") ||
    normalized.startsWith("zh-hk") ||
    normalized.startsWith("zh-mo")
  ) {
    return "zh-Hant";
  }
  if (normalized.startsWith("zh")) {
    return "zh-Hans";
  }
  if (normalized.startsWith("ja")) {
    return "ja";
  }
  if (normalized.startsWith("ko")) {
    return "ko";
  }
  if (normalized.startsWith("fr")) {
    return "fr";
  }
  if (normalized.startsWith("de")) {
    return "de";
  }
  if (normalized.startsWith("it")) {
    return "it";
  }
  if (normalized.startsWith("es")) {
    return "es";
  }
  if (normalized.startsWith("ru")) {
    return "ru";
  }
  if (normalized.startsWith("nl")) {
    return "nl";
  }
  return "en";
}

export function preferredAppLocale(identifiers: readonly string[]): AppLocaleID {
  for (const identifier of identifiers) {
    const resolved = resolveAppLocale(identifier);
    if (resolved !== "en" || identifier.trim().toLowerCase().startsWith("en")) {
      return resolved;
    }
  }
  return "en";
}

export function systemDefaultAppLocale(): AppLocaleID {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return preferredAppLocale([locale]);
}

export function defaultAppSettings(): AppSettings {
  return {
    launchAtStartup: false,
    launchCodexAfterSwitch: true,
    autoSmartSwitch: false,
    restartEditorsOnSwitch: false,
    restartEditorTargets: [],
    locale: systemDefaultAppLocale(),
    proxyPort: 18317,
    proxyApiKey: "",
    autoStartProxy: false
  };
}

export function generateProxyApiKey(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return `sk-local-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function isEditorAppID(value: string): value is EditorAppID {
  return (editorAppIds as readonly string[]).includes(value);
}

export function normalizeEditorAppIDs(values: readonly string[]): EditorAppID[] {
  return values.filter(isEditorAppID);
}
