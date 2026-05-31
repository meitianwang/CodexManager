import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppInfo } from "../shared/app-info";
import type { AccountsImportDraftDescriptor, AccountsImportResult } from "../shared/models/account-transfer";
import type { AccountSummary, WeeklyQuotaWarmupResult } from "../shared/models/accounts";
import type { InstalledEditorApp, SmartSwitchResult, SwitchAccountExecutionResult } from "../shared/models/app";
import type { AppSettings, AppSettingsPatch } from "../shared/models/settings";
import type { ProxyRuntimeState } from "../shared/models/proxy";
import { ipcChannels } from "../shared/ipc/schema";

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
    importPreparedPackage: (draftId: string, accountIds: string[]) => Promise<AccountsImportResult>;
    list: () => Promise<AccountSummary[]>;
    onChanged: (listener: (accounts: AccountSummary[]) => void) => () => void;
    prepareImportPackage: () => Promise<AccountsImportDraftDescriptor | undefined>;
    refreshAllUsage: () => Promise<AccountSummary[]>;
    refreshUsage: (id: string) => Promise<AccountSummary>;
    smartSwitch: () => Promise<SmartSwitchResult | undefined>;
    switch: (id: string, workspacePath?: string) => Promise<SwitchAccountExecutionResult>;
    updateTeamAlias: (id: string, alias?: string) => Promise<AccountSummary>;
    warmUpWeeklyQuota: () => Promise<WeeklyQuotaWarmupResult>;
  };
  clipboard: {
    writeText: (text: string) => Promise<void>;
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
    prepareImportPackage: () => invoke<AccountsImportDraftDescriptor | undefined>(ipcChannels.accountsPrepareImportPackage),
    refreshAllUsage: () => invoke<AccountSummary[]>(ipcChannels.accountsRefreshAllUsage),
    refreshUsage: (id) => invoke<AccountSummary>(ipcChannels.accountsRefreshUsage, { id }),
    smartSwitch: () => invoke<SmartSwitchResult | undefined>(ipcChannels.accountsSmartSwitch),
    switch: (id, workspacePath) => invoke<SwitchAccountExecutionResult>(ipcChannels.accountsSwitch, { id, workspacePath }),
    updateTeamAlias: (id, alias) => invoke<AccountSummary>(ipcChannels.accountsUpdateTeamAlias, { id, alias }),
    warmUpWeeklyQuota: () => invoke<WeeklyQuotaWarmupResult>(ipcChannels.accountsWarmUpWeeklyQuota)
  },
  clipboard: {
    writeText: (text) => invoke<void>(ipcChannels.clipboardWriteText, { text })
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
