import { z } from "zod";
import { appLocales, editorAppIds } from "../models/settings";

export const ipcChannels = {
  appInfo: "app:info",
  appOpenRepository: "app:openRepository",
  appQuit: "app:quit",
  accountsAddViaLogin: "accounts:addViaLogin",
  accountsChanged: "accounts:changed",
  accountsDelete: "accounts:delete",
  accountsExportPackage: "accounts:exportPackage",
  accountsImportCurrentAuth: "accounts:importCurrentAuth",
  accountsImportPreparedPackage: "accounts:importPreparedPackage",
  accountsList: "accounts:list",
  accountsPrepareImportPackage: "accounts:prepareImportPackage",
  accountsRefreshAllUsage: "accounts:refreshAllUsage",
  accountsRefreshUsage: "accounts:refreshUsage",
  accountsSmartSwitch: "accounts:smartSwitch",
  accountsSwitch: "accounts:switch",
  accountsUpdateTeamAlias: "accounts:updateTeamAlias",
  accountsWarmUpWeeklyQuota: "accounts:warmUpWeeklyQuota",
  clipboardWriteText: "clipboard:writeText",
  proxyGetState: "proxy:getState",
  proxyRegenerateApiKey: "proxy:regenerateApiKey",
  proxyStart: "proxy:start",
  proxyStop: "proxy:stop",
  settingsGet: "settings:get",
  settingsListEditors: "settings:listEditors",
  settingsUpdate: "settings:update"
} as const;

const accountId = z.string().trim().min(1);
const editorAppId = z.enum(editorAppIds);
const appLocale = z.enum(appLocales);

export const accountIdSchema = z.object({
  id: accountId
});

export const switchAccountSchema = z.object({
  id: accountId,
  workspacePath: z.string().optional()
});

export const updateTeamAliasSchema = z.object({
  id: accountId,
  alias: z.string().optional()
});

export const exportAccountsPackageSchema = z.object({
  accountIds: z.array(accountId).min(1)
});

export const importPreparedAccountsPackageSchema = z.object({
  draftId: z.string().trim().min(1),
  accountIds: z.array(accountId).min(1)
});

export const settingsPatchSchema = z
  .object({
    autoSmartSwitch: z.boolean().optional(),
    autoStartProxy: z.boolean().optional(),
    launchAtStartup: z.boolean().optional(),
    launchCodexAfterSwitch: z.boolean().optional(),
    locale: appLocale.or(z.string().trim().min(1)).optional(),
    proxyApiKey: z.string().optional(),
    proxyPort: z.number().int().min(1).max(65_535).optional(),
    restartEditorTargets: z.array(editorAppId).optional(),
    restartEditorsOnSwitch: z.boolean().optional()
  })
  .strict();

export const proxyStartSchema = z.object({
  apiKey: z.string().optional(),
  port: z.number().int().min(1).max(65_535)
});

export const clipboardWriteTextSchema = z.object({
  text: z.string()
});

export function parseIpcInput<Schema extends z.ZodType>(schema: Schema, value: unknown): z.infer<Schema> {
  return schema.parse(value);
}
