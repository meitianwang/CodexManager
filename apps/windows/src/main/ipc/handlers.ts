import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { IpcMain } from "electron";
import { app, clipboard, dialog, shell } from "electron";
import type { WindowsAppContext } from "../app-context";
import { appInfo } from "../../shared/app-info";
import { toAccountSummary } from "../../shared/domain/accounts-store";
import type {
  AccountsImportDraftDescriptor,
  AccountsTransferPackage,
  AccountTransferSelectableItem
} from "../../shared/models/account-transfer";
import type { AccountSummary } from "../../shared/models/accounts";
import type { ProxyRuntimeState } from "../../shared/models/proxy";
import type { AppSettings } from "../../shared/models/settings";
import {
  accountIdSchema,
  clipboardWriteTextSchema,
  exportAccountsPackageSchema,
  importPreparedAccountsPackageSchema,
  ipcChannels,
  parseIpcInput,
  proxyStartSchema,
  refreshWorkspaceMetadataSchema,
  settingsPatchSchema,
  switchAccountSchema,
  updateTeamAliasSchema
} from "../../shared/ipc/schema";

export interface IpcHandlerOptions {
  onAccountsChanged?: (accounts: AccountSummary[]) => void;
  onProxyStateChanged?: (state: ProxyRuntimeState) => void;
  onSettingsChanged?: (settings: AppSettings) => void;
}

const maxAccountImportDrafts = 8;

export function registerIpcHandlers(ipcMain: IpcMain, context: WindowsAppContext, options: IpcHandlerOptions = {}): void {
  const accountImportDrafts = new Map<string, AccountsTransferPackage>();

  ipcMain.handle(ipcChannels.appInfo, () => appInfo);
  ipcMain.handle(ipcChannels.appOpenRepository, () => shell.openExternal("https://github.com/meitianwang/CodexManager"));
  ipcMain.handle(ipcChannels.appQuit, () => {
    app.quit();
  });

  ipcMain.handle(ipcChannels.accountsList, () => context.accountsCoordinator.listAccounts());
  ipcMain.handle(ipcChannels.accountsImportCurrentAuth, async () => {
    const account = await context.accountsCoordinator.importCurrentAuthAccount();
    await publishLatestAccounts(context, options);
    return account;
  });
  ipcMain.handle(ipcChannels.accountsAddViaLogin, async () => {
    const account = await context.accountsCoordinator.addAccountViaLogin();
    await publishLatestAccounts(context, options);
    return account;
  });
  ipcMain.handle(ipcChannels.accountsRefreshAllUsage, async () => {
    const accounts = await context.accountsCoordinator.refreshAllUsage();
    options.onAccountsChanged?.(accounts);
    return accounts;
  });
  ipcMain.handle(ipcChannels.accountsWarmUpWeeklyQuota, async () => {
    const result = await context.accountsCoordinator.warmUpResetWeeklyQuotaAccounts();
    options.onAccountsChanged?.(result.accounts);
    return result;
  });

  ipcMain.handle(ipcChannels.accountsRefreshUsage, async (_event, input: unknown) => {
    const { id } = parseIpcInput(accountIdSchema, input);
    const account = await context.accountsCoordinator.refreshAccountUsage(id);
    await publishLatestAccounts(context, options);
    return account;
  });

  ipcMain.handle(ipcChannels.accountsRefreshWorkspaceMetadata, async (_event, input: unknown) => {
    const { forceRemoteCheck } = parseIpcInput(refreshWorkspaceMetadataSchema, input);
    const accounts = await context.accountsCoordinator.refreshWorkspaceMetadata(forceRemoteCheck ?? false);
    options.onAccountsChanged?.(accounts);
    return accounts;
  });

  ipcMain.handle(ipcChannels.accountsSwitch, async (_event, input: unknown) => {
    const { id, workspacePath } = parseIpcInput(switchAccountSchema, input);
    const result = await context.accountsCoordinator.switchAccountAndApplySettings(id, workspacePath);
    await publishLatestAccounts(context, options);
    return result;
  });

  ipcMain.handle(ipcChannels.accountsSmartSwitch, async () => {
    const result = await context.accountsCoordinator.smartSwitch();
    await publishLatestAccounts(context, options);
    return result;
  });

  ipcMain.handle(ipcChannels.accountsDelete, async (_event, input: unknown) => {
    const { id } = parseIpcInput(accountIdSchema, input);
    await context.accountsCoordinator.deleteAccount(id);
    await publishLatestAccounts(context, options);
  });

  ipcMain.handle(ipcChannels.accountsUpdateTeamAlias, async (_event, input: unknown) => {
    const { id, alias } = parseIpcInput(updateTeamAliasSchema, input);
    const account = await context.accountsCoordinator.updateTeamAlias(id, alias);
    await publishLatestAccounts(context, options);
    return account;
  });

  ipcMain.handle(ipcChannels.accountsExportPackage, async (_event, input: unknown) => {
    const { accountIds } = parseIpcInput(exportAccountsPackageSchema, input);
    const result = await dialog.showSaveDialog({
      defaultPath: "CodexManager-accounts.json",
      filters: [{ name: "CodexManager account package", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    await writeFile(result.filePath, await context.accountsCoordinator.encodeAccountsTransferPackage(new Set(accountIds)), "utf8");
    return { canceled: false, path: result.filePath };
  });

  ipcMain.handle(ipcChannels.accountsPrepareImportPackage, async (): Promise<AccountsImportDraftDescriptor | undefined> => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: "CodexManager account package", extensions: ["json"] }],
      properties: ["openFile"]
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) {
      return undefined;
    }

    const accountPackage = await context.accountsCoordinator.loadAccountsTransferPackage(path);
    const draftId = rememberAccountImportDraft(accountImportDrafts, accountPackage);
    return {
      draftId,
      accounts: accountPackage.accounts.map(accountTransferSelectableItem)
    };
  });

  ipcMain.handle(ipcChannels.accountsImportPreparedPackage, async (_event, input: unknown) => {
    const { draftId, accountIds } = parseIpcInput(importPreparedAccountsPackageSchema, input);
    const accountPackage = accountImportDrafts.get(draftId);
    if (!accountPackage) {
      throw new Error("The selected account package has expired. Choose the package again.");
    }

    try {
      const result = await context.accountsCoordinator.importAccountsTransferPackage(accountPackage, new Set(accountIds));
      await publishLatestAccounts(context, options);
      return result;
    } finally {
      accountImportDrafts.delete(draftId);
    }
  });

  ipcMain.handle(ipcChannels.accountsImportPackage, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: "CodexManager account package", extensions: ["json"] }],
      properties: ["openFile"]
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) {
      return undefined;
    }
    const accountPackage = await context.accountsCoordinator.loadAccountsTransferPackage(path);
    const importResult = await context.accountsCoordinator.importAccountsTransferPackage(
      accountPackage,
      new Set(accountPackage.accounts.map((account) => account.id))
    );
    await publishLatestAccounts(context, options);
    return importResult;
  });

  ipcMain.handle(ipcChannels.settingsGet, () => context.settingsCoordinator.currentSettings());
  ipcMain.handle(ipcChannels.settingsListEditors, () => context.editorAppService.listInstalledApps());
  ipcMain.handle(ipcChannels.settingsUpdate, async (_event, input: unknown) => {
    const patch = parseIpcInput(settingsPatchSchema, input);
    const settings = await context.settingsCoordinator.updateSettings(patch);
    options.onSettingsChanged?.(settings);
    return settings;
  });

  ipcMain.handle(ipcChannels.proxyGetState, () => context.proxyRuntimeService.getState());
  ipcMain.handle(ipcChannels.proxyRegenerateApiKey, () => context.proxyRuntimeService.regenerateApiKey());
  ipcMain.handle(ipcChannels.proxyStart, async (_event, input: unknown) => {
    const { port, apiKey } = parseIpcInput(proxyStartSchema, input);
    const state = await context.proxyRuntimeService.start(port, apiKey);
    options.onProxyStateChanged?.(state);
    return state;
  });
  ipcMain.handle(ipcChannels.proxyStop, async () => {
    const state = await context.proxyRuntimeService.stop();
    options.onProxyStateChanged?.(state);
    return state;
  });

  ipcMain.handle(ipcChannels.clipboardWriteText, (_event, input: unknown) => {
    const { text } = parseIpcInput(clipboardWriteTextSchema, input);
    clipboard.writeText(text);
  });
}

function rememberAccountImportDraft(drafts: Map<string, AccountsTransferPackage>, accountPackage: AccountsTransferPackage): string {
  const draftId = randomUUID();
  drafts.set(draftId, accountPackage);
  while (drafts.size > maxAccountImportDrafts) {
    const oldestDraftId = drafts.keys().next().value;
    if (oldestDraftId === undefined) {
      break;
    }
    drafts.delete(oldestDraftId);
  }
  return draftId;
}

async function publishLatestAccounts(context: WindowsAppContext, options: IpcHandlerOptions): Promise<void> {
  if (!options.onAccountsChanged) {
    return;
  }
  options.onAccountsChanged(await context.accountsCoordinator.listAccounts());
}

function accountTransferSelectableItem(account: AccountsTransferPackage["accounts"][number]): AccountTransferSelectableItem {
  const summary = toAccountSummary(account);
  return {
    id: summary.id,
    label: summary.label,
    email: summary.email,
    accountId: summary.accountId,
    planLabel: summary.normalizedPlanLabel,
    teamName: summary.displayTeamName,
    isCurrent: false
  };
}
