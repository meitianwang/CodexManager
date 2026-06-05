import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { IpcMain } from "electron";
import { app, clipboard, dialog, shell } from "electron";
import type { DesktopAppContext } from "../app-context";
import { appInfo } from "../../shared/app-info";
import { toAccountSummary } from "../../shared/domain/accounts-store";
import type {
  AccountsImportFileResult,
  AccountsTransferPackage,
  AccountTransferSelectableItem
} from "../../shared/models/account-transfer";
import { accountsTransferFormatIdentifier } from "../../shared/models/account-transfer";
import type { AccountSummary } from "../../shared/models/accounts";
import { parseJsonValue } from "../../shared/models/json-value";
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
  settingsPatchSchema,
  switchAccountSchema
} from "../../shared/ipc/schema";
import { parseAccountsTransferPackage } from "../repositories/store-parsers";
import { validateAccountsTransferPackage } from "../services/accounts-coordinator";

export interface IpcHandlerOptions {
  onAccountsChanged?: (accounts: AccountSummary[]) => void;
  onProxyStateChanged?: (state: ProxyRuntimeState) => void;
  onSettingsChanged?: (settings: AppSettings) => void;
}

const maxAccountImportDrafts = 8;

export function registerIpcHandlers(ipcMain: IpcMain, context: DesktopAppContext, options: IpcHandlerOptions = {}): void {
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
    const account = await context.accountsCoordinator.refreshAccountUsage(id, { allowInteractiveAuthRepair: true });
    await publishLatestAccounts(context, options);
    return account;
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

  ipcMain.handle(ipcChannels.accountsImportFile, async (): Promise<AccountsImportFileResult | undefined> => {
    const path = await resolveAccountsImportFilePath();
    if (!path) {
      return undefined;
    }

    const json = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (isAccountsTransferPackageCandidate(json)) {
      const accountPackage = parseAccountsTransferPackage(json);
      validateAccountsTransferPackage(accountPackage);
      const draftId = rememberAccountImportDraft(accountImportDrafts, accountPackage);
      return {
        kind: "package",
        draft: {
          draftId,
          accounts: accountPackage.accounts.map(accountTransferSelectableItem)
        }
      };
    }

    const account = await context.accountsCoordinator.importAccount(parseJsonValue(json, "auth JSON"));
    await publishLatestAccounts(context, options);
    return { kind: "auth", account };
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

  ipcMain.handle(ipcChannels.settingsGet, () => context.settingsCoordinator.currentSettings());
  ipcMain.handle(ipcChannels.settingsListEditors, () => context.editorAppService.listInstalledApps());
  ipcMain.handle(ipcChannels.settingsUpdate, async (_event, input: unknown) => {
    const patch = parseIpcInput(settingsPatchSchema, input);
    const settings = await context.settingsCoordinator.updateSettings(patch);
    options.onSettingsChanged?.(settings);
    return settings;
  });

  ipcMain.handle(ipcChannels.codexAppGetStatus, () => context.codexAppIntegrationService.status());
  ipcMain.handle(ipcChannels.codexAppConfigure, async () => {
    const status = await context.codexAppIntegrationService.configure();
    options.onProxyStateChanged?.(await context.proxyRuntimeService.getState());
    return status;
  });
  ipcMain.handle(ipcChannels.codexAppRestoreSafe, () => context.codexAppIntegrationService.restoreSafe());
  ipcMain.handle(ipcChannels.codexAppRestoreSnapshot, () => context.codexAppIntegrationService.restoreSnapshot());

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

async function resolveAccountsImportFilePath(): Promise<string | undefined> {
  const smokeImportPath = process.env.CODEX_MANAGER_ELECTRON_SMOKE_IMPORT_FILE_PATH?.trim();
  if (smokeImportPath) {
    return smokeImportPath;
  }

  const result = await dialog.showOpenDialog({
    filters: [{ name: "CodexManager account package or auth.json", extensions: ["json"] }],
    properties: ["openFile"]
  });
  if (result.canceled) {
    return undefined;
  }
  return result.filePaths[0];
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

async function publishLatestAccounts(context: DesktopAppContext, options: IpcHandlerOptions): Promise<void> {
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

function isAccountsTransferPackageCandidate(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).format === accountsTransferFormatIdentifier
  );
}
