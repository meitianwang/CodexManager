import { writeFile } from "node:fs/promises";
import type { IpcMain } from "electron";
import { clipboard, dialog } from "electron";
import type { WindowsAppContext } from "../app-context";
import { appInfo } from "../../shared/app-info";
import type { ProxyRuntimeState } from "../../shared/models/proxy";
import {
  accountIdSchema,
  clipboardWriteTextSchema,
  exportAccountsPackageSchema,
  ipcChannels,
  parseIpcInput,
  proxyStartSchema,
  refreshWorkspaceMetadataSchema,
  settingsPatchSchema,
  switchAccountSchema,
  updateTeamAliasSchema
} from "../../shared/ipc/schema";

export interface IpcHandlerOptions {
  onProxyStateChanged?: (state: ProxyRuntimeState) => void;
}

export function registerIpcHandlers(ipcMain: IpcMain, context: WindowsAppContext, options: IpcHandlerOptions = {}): void {
  ipcMain.handle(ipcChannels.appInfo, () => appInfo);

  ipcMain.handle(ipcChannels.accountsList, () => context.accountsCoordinator.listAccounts());
  ipcMain.handle(ipcChannels.accountsImportCurrentAuth, () => context.accountsCoordinator.importCurrentAuthAccount());
  ipcMain.handle(ipcChannels.accountsAddViaLogin, () => context.accountsCoordinator.addAccountViaLogin());
  ipcMain.handle(ipcChannels.accountsRefreshAllUsage, () => context.accountsCoordinator.refreshAllUsage());
  ipcMain.handle(ipcChannels.accountsWarmUpWeeklyQuota, () => context.accountsCoordinator.warmUpResetWeeklyQuotaAccounts());

  ipcMain.handle(ipcChannels.accountsRefreshUsage, (_event, input: unknown) => {
    const { id } = parseIpcInput(accountIdSchema, input);
    return context.accountsCoordinator.refreshAccountUsage(id);
  });

  ipcMain.handle(ipcChannels.accountsRefreshWorkspaceMetadata, (_event, input: unknown) => {
    const { forceRemoteCheck } = parseIpcInput(refreshWorkspaceMetadataSchema, input);
    return context.accountsCoordinator.refreshWorkspaceMetadata(forceRemoteCheck ?? false);
  });

  ipcMain.handle(ipcChannels.accountsSwitch, (_event, input: unknown) => {
    const { id, workspacePath } = parseIpcInput(switchAccountSchema, input);
    return context.accountsCoordinator.switchAccountAndApplySettings(id, workspacePath);
  });

  ipcMain.handle(ipcChannels.accountsSmartSwitch, () => context.accountsCoordinator.smartSwitch());

  ipcMain.handle(ipcChannels.accountsDelete, (_event, input: unknown) => {
    const { id } = parseIpcInput(accountIdSchema, input);
    return context.accountsCoordinator.deleteAccount(id);
  });

  ipcMain.handle(ipcChannels.accountsUpdateTeamAlias, (_event, input: unknown) => {
    const { id, alias } = parseIpcInput(updateTeamAliasSchema, input);
    return context.accountsCoordinator.updateTeamAlias(id, alias);
  });

  ipcMain.handle(ipcChannels.accountsImportAuthFile, async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: "Codex auth JSON", extensions: ["json"] }],
      properties: ["openFile"]
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) {
      return undefined;
    }
    return context.accountsCoordinator.importAccountFile(path, undefined, false);
  });

  ipcMain.handle(ipcChannels.accountsExportPackage, async (_event, input: unknown) => {
    const { accountIds } = parseIpcInput(exportAccountsPackageSchema, input);
    const result = await dialog.showSaveDialog({
      defaultPath: "codexmanager-accounts.json",
      filters: [{ name: "CodexManager account package", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    await writeFile(result.filePath, await context.accountsCoordinator.encodeAccountsTransferPackage(new Set(accountIds)), "utf8");
    return { canceled: false, path: result.filePath };
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
    return context.accountsCoordinator.importAccountsTransferPackage(
      accountPackage,
      new Set(accountPackage.accounts.map((account) => account.id))
    );
  });

  ipcMain.handle(ipcChannels.settingsGet, () => context.settingsCoordinator.currentSettings());
  ipcMain.handle(ipcChannels.settingsListEditors, () => context.editorAppService.listInstalledApps());
  ipcMain.handle(ipcChannels.settingsUpdate, (_event, input: unknown) => {
    const patch = parseIpcInput(settingsPatchSchema, input);
    return context.settingsCoordinator.updateSettings(patch);
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
