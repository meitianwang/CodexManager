import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppInfo } from "../shared/app-info";
import type { AccountsImportFileResult, AccountsImportResult } from "../shared/models/account-transfer";
import type { AccountSummary, WeeklyQuotaWarmupResult } from "../shared/models/accounts";
import type { InstalledEditorApp, SmartSwitchResult, SwitchAccountExecutionResult } from "../shared/models/app";
import type { AppSettings, AppSettingsPatch } from "../shared/models/settings";
import type { ProxyRuntimeState } from "../shared/models/proxy";
import type { CodexAppIntegrationStatus } from "../shared/models/codex-app-integration";

const ipcChannels = {
  appInfo: "app:info",
  appOpenRepository: "app:openRepository",
  appQuit: "app:quit",
  accountsAddViaLogin: "accounts:addViaLogin",
  accountsChanged: "accounts:changed",
  accountsDelete: "accounts:delete",
  accountsExportPackage: "accounts:exportPackage",
  accountsImportFile: "accounts:importFile",
  accountsImportCurrentAuth: "accounts:importCurrentAuth",
  accountsImportPreparedPackage: "accounts:importPreparedPackage",
  accountsList: "accounts:list",
  accountsRefreshAllUsage: "accounts:refreshAllUsage",
  accountsRefreshUsage: "accounts:refreshUsage",
  accountsSmartSwitch: "accounts:smartSwitch",
  accountsSwitch: "accounts:switch",
  accountsWarmUpWeeklyQuota: "accounts:warmUpWeeklyQuota",
  clipboardWriteText: "clipboard:writeText",
  codexAppConfigure: "codexApp:configure",
  codexAppGetStatus: "codexApp:getStatus",
  codexAppRestore: "codexApp:restore",
  proxyGetState: "proxy:getState",
  proxyRegenerateApiKey: "proxy:regenerateApiKey",
  proxyStart: "proxy:start",
  proxyStop: "proxy:stop",
  settingsGet: "settings:get",
  settingsListEditors: "settings:listEditors",
  settingsUpdate: "settings:update"
} as const;

export interface CodexManagerAPI {
  getAppInfo: () => Promise<AppInfo>;
  app: {
    openRepository: () => Promise<void>;
    quit: () => Promise<void>;
  };
  accounts: {
    addViaLogin: () => Promise<AccountSummary>;
    delete: (id: string) => Promise<void>;
    exportPackage: (accountIds: string[]) => Promise<{ canceled: boolean; path?: string }>;
    importCurrentAuth: () => Promise<AccountSummary>;
    importFile: () => Promise<AccountsImportFileResult | undefined>;
    importPreparedPackage: (draftId: string, accountIds: string[]) => Promise<AccountsImportResult>;
    list: () => Promise<AccountSummary[]>;
    onChanged: (listener: (accounts: AccountSummary[]) => void) => () => void;
    refreshAllUsage: () => Promise<AccountSummary[]>;
    refreshUsage: (id: string) => Promise<AccountSummary>;
    smartSwitch: () => Promise<SmartSwitchResult | undefined>;
    switch: (id: string, workspacePath?: string) => Promise<SwitchAccountExecutionResult>;
    warmUpWeeklyQuota: () => Promise<WeeklyQuotaWarmupResult>;
  };
  clipboard: {
    writeText: (text: string) => Promise<void>;
  };
  codexApp: {
    configure: () => Promise<CodexAppIntegrationStatus>;
    getStatus: () => Promise<CodexAppIntegrationStatus>;
    restore: () => Promise<CodexAppIntegrationStatus>;
  };
  proxy: {
    getState: () => Promise<ProxyRuntimeState>;
    regenerateApiKey: () => Promise<ProxyRuntimeState>;
    start: (port: number, apiKey?: string) => Promise<ProxyRuntimeState>;
    stop: () => Promise<ProxyRuntimeState>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    listEditors: () => Promise<InstalledEditorApp[]>;
    update: (patch: AppSettingsPatch) => Promise<AppSettings>;
  };
}

const api: CodexManagerAPI = {
  getAppInfo: () => invoke<AppInfo>(ipcChannels.appInfo),
  app: {
    openRepository: () => invoke<void>(ipcChannels.appOpenRepository),
    quit: () => invoke<void>(ipcChannels.appQuit)
  },
  accounts: {
    addViaLogin: () => invoke<AccountSummary>(ipcChannels.accountsAddViaLogin),
    delete: (id) => invoke<void>(ipcChannels.accountsDelete, { id }),
    exportPackage: (accountIds) =>
      invoke<{ canceled: boolean; path?: string }>(ipcChannels.accountsExportPackage, { accountIds }),
    importCurrentAuth: () => invoke<AccountSummary>(ipcChannels.accountsImportCurrentAuth),
    importFile: () => invoke<AccountsImportFileResult | undefined>(ipcChannels.accountsImportFile),
    importPreparedPackage: (draftId, accountIds) =>
      invoke<AccountsImportResult>(ipcChannels.accountsImportPreparedPackage, { draftId, accountIds }),
    list: () => invoke<AccountSummary[]>(ipcChannels.accountsList),
    onChanged: (listener) => {
      const handler = (_event: IpcRendererEvent, accounts: AccountSummary[]) => {
        listener(accounts);
      };
      ipcRenderer.on(ipcChannels.accountsChanged, handler);
      return () => ipcRenderer.off(ipcChannels.accountsChanged, handler);
    },
    refreshAllUsage: () => invoke<AccountSummary[]>(ipcChannels.accountsRefreshAllUsage),
    refreshUsage: (id) => invoke<AccountSummary>(ipcChannels.accountsRefreshUsage, { id }),
    smartSwitch: () => invoke<SmartSwitchResult | undefined>(ipcChannels.accountsSmartSwitch),
    switch: (id, workspacePath) => invoke<SwitchAccountExecutionResult>(ipcChannels.accountsSwitch, { id, workspacePath }),
    warmUpWeeklyQuota: () => invoke<WeeklyQuotaWarmupResult>(ipcChannels.accountsWarmUpWeeklyQuota)
  },
  clipboard: {
    writeText: (text) => invoke<void>(ipcChannels.clipboardWriteText, { text })
  },
  codexApp: {
    configure: () => invoke<CodexAppIntegrationStatus>(ipcChannels.codexAppConfigure),
    getStatus: () => invoke<CodexAppIntegrationStatus>(ipcChannels.codexAppGetStatus),
    restore: () => invoke<CodexAppIntegrationStatus>(ipcChannels.codexAppRestore)
  },
  proxy: {
    getState: () => invoke<ProxyRuntimeState>(ipcChannels.proxyGetState),
    regenerateApiKey: () => invoke<ProxyRuntimeState>(ipcChannels.proxyRegenerateApiKey),
    start: (port, apiKey) => invoke<ProxyRuntimeState>(ipcChannels.proxyStart, { port, apiKey }),
    stop: () => invoke<ProxyRuntimeState>(ipcChannels.proxyStop)
  },
  settings: {
    get: () => invoke<AppSettings>(ipcChannels.settingsGet),
    listEditors: () => invoke<InstalledEditorApp[]>(ipcChannels.settingsListEditors),
    update: (patch) => invoke<AppSettings>(ipcChannels.settingsUpdate, patch)
  }
};

contextBridge.exposeInMainWorld("codexManager", api);

function invoke<Result>(channel: string, input?: unknown): Promise<Result> {
  return ipcRenderer.invoke(channel, input) as Promise<Result>;
}
