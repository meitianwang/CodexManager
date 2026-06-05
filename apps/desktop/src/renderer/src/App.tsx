import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { appInfo as fallbackAppInfo, type AppInfo } from "@shared/app-info";
import { sortByRemaining, sortForDisplay } from "@shared/domain/account-ranking";
import type { AccountsImportDraftDescriptor, AccountTransferSelectableItem } from "@shared/models/account-transfer";
import type { AccountSummary, WeeklyQuotaWarmupResult } from "@shared/models/accounts";
import type { InstalledEditorApp, SwitchAccountExecutionResult } from "@shared/models/app";
import type { CodexAppIntegrationStatus } from "@shared/models/codex-app-integration";
import { codexAppDefaultModel, codexAppProviderId } from "@shared/models/codex-app-integration";
import {
  appLocales,
  defaultAppSettings,
  generateProxyApiKey,
  resolveAppLocale,
  type AppSettings,
  type AppSettingsPatch,
  type AppLocaleID,
  type EditorAppID
} from "@shared/models/settings";
import { proxyAvailableModels, proxyEndpoints, type ProxyEndpointID, type ProxyRuntimeState } from "@shared/models/proxy";
import { createTranslator, languageNameKey, type Translator } from "./i18n";
import "./styles/app.css";

type PageID = "accounts" | "proxy" | "settings";
type AccountViewMode = "grid" | "list";
type AccountsContentState = { status: "error"; message: string } | { status: "loading" } | { status: "ready" };
type AccountToolbarBusyAction = "add" | "export" | "importCurrent" | "importPackage" | "refreshAll" | "warmUpWeeklyQuota";
type NoticeTone = "success" | "error" | "info";
type SymbolIconName =
  | "code"
  | "flame"
  | "gearshape"
  | "grid"
  | "list"
  | "person2"
  | "plus"
  | "refresh"
  | "serverRack"
  | "squareAndArrowDown"
  | "squareAndArrowUp"
  | "switch"
  | "trash"
  | "trayAndArrowDown"
  | "wandAndStars";
type AccountTransferDialogState =
  | { mode: "export"; accounts: AccountTransferSelectableItem[] }
  | { mode: "import"; draft: AccountsImportDraftDescriptor };

interface Notice {
  text: string;
  tone: NoticeTone;
}

const noticeDismissDelayMs: Record<NoticeTone, number> = {
  error: 5_000,
  info: 3_000,
  success: 3_000
};

const pageIconNames: Record<PageID, SymbolIconName> = {
  accounts: "person2",
  proxy: "serverRack",
  settings: "gearshape"
};

function SymbolIcon({
  className,
  name,
  size = 18,
  strokeWidth = 2.2
}: {
  className?: string;
  name: SymbolIconName;
  size?: number;
  strokeWidth?: number;
}): ReactElement {
  const iconClassName = ["symbol-icon", className].filter(Boolean).join(" ");
  const strokeProps = {
    "aria-hidden": true,
    className: iconClassName,
    fill: "none",
    focusable: false,
    height: size,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth,
    viewBox: "0 0 24 24",
    width: size
  };

  switch (name) {
    case "code":
      return (
        <svg {...strokeProps}>
          <path d="m8.2 6-5 6 5 6" />
          <path d="m15.8 6 5 6-5 6" />
          <path d="m14 4-4 16" />
        </svg>
      );
    case "flame":
      return (
        <svg {...strokeProps}>
          <path d="M12 22c4 0 7-2.8 7-6.7 0-2.9-1.8-5.1-4.5-7.7-.7 2.7-2.2 4.1-4.3 4.9.3-2.8-.6-5.1-2.7-7.5C5.7 7.4 5 9.7 5 12.2 5 18 8 22 12 22Z" />
          <path d="M12 18.5c1.4 0 2.5-1 2.5-2.4 0-1-.6-1.8-1.7-2.8-.3 1-.9 1.6-1.8 1.9.1-1-.2-1.9-.9-2.8-.8 1-1.1 1.9-1.1 2.9 0 2 1.1 3.2 3 3.2Z" />
        </svg>
      );
    case "gearshape":
      return (
        <svg {...strokeProps}>
          <path d="M12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Z" />
          <path d="M18.2 12.8c.1-.5.1-1.1 0-1.6l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.4-.8L14 3.8h-4l-.4 2.6c-.5.2-1 .5-1.4.8l-2.4-1-2 3.5 2 1.5a8 8 0 0 0 0 1.6l-2 1.5 2 3.5 2.4-1c.4.3.9.6 1.4.8l.4 2.6h4l.4-2.6c.5-.2 1-.5 1.4-.8l2.4 1 2-3.5-2-1.5Z" />
        </svg>
      );
    case "grid":
      return (
        <svg {...strokeProps}>
          <rect x="4" y="4" width="6" height="6" rx="1.4" />
          <rect x="14" y="4" width="6" height="6" rx="1.4" />
          <rect x="4" y="14" width="6" height="6" rx="1.4" />
          <rect x="14" y="14" width="6" height="6" rx="1.4" />
        </svg>
      );
    case "list":
      return (
        <svg {...strokeProps}>
          <path d="M8 6h12" />
          <path d="M8 12h12" />
          <path d="M8 18h12" />
          <path d="M4 6h.01" />
          <path d="M4 12h.01" />
          <path d="M4 18h.01" />
        </svg>
      );
    case "person2":
      return (
        <svg {...strokeProps}>
          <path d="M9.2 11.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z" fill="currentColor" stroke="none" />
          <path d="M15.8 10.8a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8Z" fill="currentColor" stroke="none" opacity="0.92" />
          <path d="M3.4 19.2c.5-3.5 2.6-5.3 5.8-5.3s5.3 1.8 5.8 5.3Z" fill="currentColor" stroke="none" />
          <path d="M13.1 19.2c.2-2.4 1.8-4.4 4.2-4.4 2.1 0 3.7 1.5 4.1 4.4Z" fill="currentColor" stroke="none" opacity="0.92" />
        </svg>
      );
    case "plus":
      return (
        <svg {...strokeProps}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...strokeProps}>
          <path d="M20 6v5h-5" />
          <path d="M4 18v-5h5" />
          <path d="M18.6 10.2A7 7 0 0 0 6.1 7.4L4 9.4" />
          <path d="M5.4 13.8a7 7 0 0 0 12.5 2.8l2.1-2" />
        </svg>
      );
    case "serverRack":
      return (
        <svg {...strokeProps}>
          <rect x="5" y="3.5" width="14" height="17" rx="2" />
          <path d="M5 9h14" />
          <path d="M5 15h14" />
          <path d="M8.2 6.3h.01" />
          <path d="M8.2 12h.01" />
          <path d="M8.2 17.8h.01" />
          <path d="M11 6.3h5" />
          <path d="M11 12h5" />
          <path d="M11 17.8h5" />
        </svg>
      );
    case "squareAndArrowDown":
      return (
        <svg {...strokeProps}>
          <path d="M12 3.5v10" />
          <path d="m8 9.5 4 4 4-4" />
          <path d="M5.5 11.5v7a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-7" />
        </svg>
      );
    case "squareAndArrowUp":
      return (
        <svg {...strokeProps}>
          <path d="M12 14.5v-11" />
          <path d="m8 7.5 4-4 4 4" />
          <path d="M5.5 11.5v7a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-7" />
        </svg>
      );
    case "switch":
      return (
        <svg {...strokeProps}>
          <path d="M4 8h14" />
          <path d="m15 5 3 3-3 3" />
          <path d="M20 16H6" />
          <path d="m9 13-3 3 3 3" />
        </svg>
      );
    case "trash":
      return (
        <svg {...strokeProps}>
          <path d="M4 7h16" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 7l.5-2h5L15 7" />
          <path d="M6.5 7 7.4 20h9.2l.9-13" />
        </svg>
      );
    case "trayAndArrowDown":
      return (
        <svg {...strokeProps}>
          <path d="M12 3.5v9" />
          <path d="m8 8.5 4 4 4-4" />
          <path d="M4.5 14h4l1.2 3h4.6l1.2-3h4v5.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5Z" />
        </svg>
      );
    case "wandAndStars":
      return (
        <svg {...strokeProps}>
          <path d="m15 4 5 5" />
          <path d="M13.5 5.5 18.5 10.5 9 20 4 15Z" />
          <path d="M5 4v3" />
          <path d="M3.5 5.5h3" />
          <path d="M19 16v3" />
          <path d="M17.5 17.5h3" />
        </svg>
      );
  }
}

function ToolbarActionContent({
  iconClassName,
  iconName,
  label
}: {
  iconClassName: string;
  iconName: SymbolIconName;
  label: string;
}): ReactElement {
  return (
    <>
      <SymbolIcon className={`toolbar-action-icon ${iconClassName}`} name={iconName} size={13} strokeWidth={2.3} />
      <span>{label}</span>
    </>
  );
}

function App(): ReactElement {
  const api = window.codexManager;
  const [activePage, setActivePage] = useState<PageID>("accounts");
  const [appInfo, setAppInfo] = useState<AppInfo>(fallbackAppInfo);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [accountsContentState, setAccountsContentState] = useState<AccountsContentState>(() =>
    api ? { status: "loading" } : { status: "ready" }
  );
  const [transferDialog, setTransferDialog] = useState<AccountTransferDialogState | undefined>();
  const [settings, setSettings] = useState<AppSettings>(() => defaultAppSettings());
  const [installedEditors, setInstalledEditors] = useState<InstalledEditorApp[]>([]);
  const [proxyState, setProxyState] = useState<ProxyRuntimeState>(() => fallbackProxyState(settings));
  const [codexAppStatus, setCodexAppStatus] = useState<CodexAppIntegrationStatus>(() => fallbackCodexAppStatus(proxyState));
  const [selectedEndpoint, setSelectedEndpoint] = useState<ProxyEndpointID>("chatCompletions");
  const [selectedModel, setSelectedModel] = useState<string>(codexAppDefaultModel);
  const [notice, setNotice] = useState<Notice | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [accountToolbarBusyAction, setAccountToolbarBusyAction] = useState<AccountToolbarBusyAction | undefined>();
  const [switchingAccountId, setSwitchingAccountId] = useState<string | undefined>();
  const t = useMemo(() => createTranslator(settings.locale), [settings.locale]);
  const pages = useMemo(
    () => [
      { id: "accounts" as const, label: t("tab.accounts") },
      { id: "proxy" as const, label: t("tab.proxy") },
      { id: "settings" as const, label: t("tab.settings") }
    ],
    [t]
  );

  const runAction = useCallback(
    async (
      label: string,
      action: () => Promise<void>,
      options: { accountToolbarBusyAction?: AccountToolbarBusyAction; silentSuccess?: boolean; success?: string; switchingAccountId?: string } = {}
    ) => {
      setBusyAction(label);
      if (options.accountToolbarBusyAction) {
        setAccountToolbarBusyAction(options.accountToolbarBusyAction);
      }
      if (options.switchingAccountId) {
        setSwitchingAccountId(options.switchingAccountId);
      }
      setNotice(undefined);
      try {
        await action();
        if (!options.silentSuccess) {
          setNotice({ tone: "success", text: options.success ?? t("notice.action_complete", { action: label }) });
        }
      } catch (error) {
        setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusyAction(undefined);
        if (options.switchingAccountId) {
          setSwitchingAccountId((current) => (current === options.switchingAccountId ? undefined : current));
        }
        if (options.accountToolbarBusyAction) {
          setAccountToolbarBusyAction((current) => (current === options.accountToolbarBusyAction ? undefined : current));
        }
      }
    },
    [t]
  );

  const loadData = useCallback(async () => {
    if (!api) {
      setAccountsContentState({ status: "ready" });
      return;
    }
    setAccountsContentState({ status: "loading" });
    const [nextInfo, nextAccounts, nextSettings, nextEditors, nextProxy, nextCodexAppStatus] = await Promise.all([
      api.getAppInfo(),
      api.accounts.list(),
      api.settings.get(),
      api.settings.listEditors(),
      api.proxy.getState(),
      api.codexApp.getStatus()
    ]);
    setAppInfo(nextInfo);
    setAccounts(nextAccounts);
    setSettings(nextSettings);
    setInstalledEditors(nextEditors);
    setProxyState(nextProxy);
    setCodexAppStatus(nextCodexAppStatus);
    setSelectedModel((current) => (nextProxy.availableModels.includes(current) ? current : nextProxy.availableModels[0] ?? current));
    setAccountsContentState({ status: "ready" });
  }, [api]);

  useEffect(() => {
    void loadData().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setAccountsContentState({ status: "error", message });
      setNotice({ tone: "error", text: message });
    });
  }, [loadData]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timeout = window.setTimeout(() => {
      setNotice((current) => (current === notice ? undefined : current));
    }, noticeDismissDelayMs[notice.tone]);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const reloadAccounts = useCallback(async () => {
    if (!api) {
      return;
    }
    setAccounts(await api.accounts.list());
  }, [api]);

  const confirmAccountTransferSelection = useCallback(
    (selectedIds: Set<string>) => {
      const currentDialog = transferDialog;
      if (!currentDialog) {
        return;
      }

      setTransferDialog(undefined);
      if (currentDialog.mode === "export") {
        const accountCount = selectedIds.size;
        void runAction(
          t("accounts.transfer.export.action"),
          async () => {
            if (!api) {
              throw new Error(t("error.ipc_bridge_unavailable"));
            }
            const result = await api.accounts.exportPackage([...selectedIds]);
            setNotice(
              result.canceled
                ? { tone: "info", text: t("notice.export_canceled") }
                : { tone: "success", text: t("accounts.notice.exported_format", { count: accountCount }) }
            );
          },
          { accountToolbarBusyAction: "export", silentSuccess: true }
        );
        return;
      }

      const draftId = currentDialog.draft.draftId;
      void runAction(
        t("accounts.transfer.import.action"),
        async () => {
          if (!api) {
            throw new Error(t("error.ipc_bridge_unavailable"));
          }
          const result = await api.accounts.importPreparedPackage(draftId, [...selectedIds]);
          await reloadAccounts();
          setNotice({
            tone: "success",
            text: t("accounts.notice.imported_accounts_format", {
              inserted: result.insertedCount,
              updated: result.updatedCount
            })
          });
        },
        { accountToolbarBusyAction: "importPackage", silentSuccess: true }
      );
    },
    [api, reloadAccounts, runAction, t, transferDialog]
  );

  useEffect(() => {
    if (!api) {
      return undefined;
    }
    return api.accounts.onChanged(setAccounts);
  }, [api]);

  const updateSettings = useCallback(
    async (patch: AppSettingsPatch) => {
      if (!api) {
        setSettings((current) => ({
          ...current,
          ...patch,
          locale: patch.locale !== undefined ? resolveAppLocale(patch.locale) : current.locale,
          restartEditorTargets: patch.restartEditorTargets ?? current.restartEditorTargets
        }));
        return;
      }
      setSettings(await api.settings.update(patch));
    },
    [api]
  );

  const currentPageLabel = useMemo(() => pages.find((page) => page.id === activePage)?.label ?? t("tab.accounts"), [activePage, pages, t]);

  return (
    <main className="app-shell" data-active-page={activePage}>
      <aside className="sidebar" aria-label={t("aria.primary")}>
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <SymbolIcon className="brand-mark-icon" name="code" size={22} strokeWidth={2.6} />
          </div>
          <h1>{appInfo.displayName}</h1>
        </div>

        <nav className="nav-list">
          {pages.map((page) => (
            <button
              key={page.id}
              className={page.id === activePage ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => setActivePage(page.id)}
            >
              <SymbolIcon className={`nav-icon ${page.id}-nav-icon`} name={pageIconNames[page.id]} size={18} strokeWidth={2.35} />
              <span>{page.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-divider" />
          <div className="sidebar-status-row">
            <span className={proxyState.isRunning ? "status-dot running" : "status-dot"} />
            <span>
              {t("tab.proxy")}: {proxyState.isRunning ? t("proxy.status.running") : t("proxy.status.stopped")}
            </span>
          </div>
          <span className="app-version">v{appInfo.version}</span>
        </div>
      </aside>

      <section className="workspace" aria-label={currentPageLabel}>
        {activePage === "accounts" && (
          <AccountsPage
            accounts={accounts}
            accountToolbarBusyAction={accountToolbarBusyAction}
            busyAction={busyAction}
            switchingAccountId={switchingAccountId}
            contentState={accountsContentState}
            onAddViaLogin={() =>
              runAction(
                t("accounts.action.sign_in"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  const imported = await api.accounts.addViaLogin();
                  await reloadAccounts();
                  setNotice({
                    tone: "success",
                    text: t("accounts.notice.imported_new_format", { account: imported.label })
                  });
                },
                { accountToolbarBusyAction: "add", silentSuccess: true }
              )
            }
            onDeleteAccount={(id) =>
              runAction(
                t("accounts.action.delete"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  await api.accounts.delete(id);
                  await reloadAccounts();
                  setNotice({ tone: "info", text: t("accounts.notice.account_deleted") });
                },
                { silentSuccess: true }
              )
            }
            onExportSelected={() => {
              setNotice(undefined);
              setTransferDialog({
                mode: "export",
                accounts: accounts.map(accountSummaryToTransferSelectableItem)
              });
            }}
            onImportCurrent={() =>
              runAction(
                t("accounts.action.import_current"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  const imported = await api.accounts.importCurrentAuth();
                  await reloadAccounts();
                  setNotice({ tone: "success", text: t("accounts.notice.imported_format", { account: imported.label }) });
                },
                { accountToolbarBusyAction: "importCurrent", silentSuccess: true }
              )
            }
            onImportPackage={() =>
              runAction(
                t("accounts.action.import_package"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  const result = await api.accounts.importFile();
                  if (!result) {
                    return;
                  }
                  if (result.kind === "package") {
                    setTransferDialog({ mode: "import", draft: result.draft });
                    return;
                  }
                  await reloadAccounts();
                  setNotice({ tone: "success", text: t("accounts.notice.imported_format", { account: result.account.label }) });
                },
                { accountToolbarBusyAction: "importPackage", silentSuccess: true }
              )
            }
            onRefreshAll={() =>
              runAction(
                t("accounts.action.refresh_usage"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  setAccounts(await api.accounts.refreshAllUsage());
                  setNotice({ tone: "info", text: t("accounts.notice.accounts_refreshed") });
                },
                { accountToolbarBusyAction: "refreshAll", silentSuccess: true }
              )
            }
            onWarmUpWeeklyQuota={() =>
              runAction(
                t("accounts.action.warm_weekly_quota"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  const result = await api.accounts.warmUpWeeklyQuota();
                  setAccounts(result.accounts);
                  setNotice({ tone: weeklyWarmupNoticeTone(result), text: weeklyWarmupNotice(result, t) });
                },
                { accountToolbarBusyAction: "warmUpWeeklyQuota", silentSuccess: true }
              )
            }
            onRefreshUsage={(id) =>
              runAction(
                t("common.refresh"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  const refreshed = await api.accounts.refreshUsage(id);
                  setAccounts((current) => current.map((account) => (account.id === id ? refreshed : account)));
                },
                { silentSuccess: true }
              )
            }
            onSmartSwitch={() =>
              runAction(
                t("accounts.action.smart_switch"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  const best = sortByRemaining(accounts)[0];
                  if (!best) {
                    setNotice({ tone: "info", text: t("accounts.notice.no_switch_target") });
                    return;
                  }
                  if (best.isCurrent) {
                    setNotice({ tone: "info", text: t("accounts.notice.already_best") });
                    return;
                  }
                  const result = await api.accounts.smartSwitch();
                  await reloadAccounts();
                  if (!result) {
                    setNotice({ tone: "info", text: t("accounts.notice.no_switch_target") });
                    return;
                  }
                  setNotice(smartSwitchNotice(result.account, result.execution, t));
                },
                { silentSuccess: true }
              )
            }
            onSwitchAccount={(id) =>
              runAction(
                t("accounts.action.switch"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  const execution = await api.accounts.switch(id);
                  await reloadAccounts();
                  setNotice(switchNotice(execution, t));
                },
                { silentSuccess: true, switchingAccountId: id }
              )
            }
            locale={settings.locale}
            t={t}
          />
        )}

        {activePage === "proxy" && (
          <ProxyPage
            busyAction={busyAction}
            hasAccounts={accounts.length > 0}
            onCopy={(text, success) =>
              runAction(
                t("action.copy"),
                async () => {
                  if (!api) {
                    await navigator.clipboard.writeText(text);
                    return;
                  }
                  await api.clipboard.writeText(text);
                },
                { silentSuccess: success === undefined, success }
              )
            }
            onRegenerateApiKey={() =>
              runAction(
                t("proxy.api_key.regenerate"),
                async () => {
                  if (!api) {
                    const apiKey = generateProxyApiKey();
                    setProxyState((current) => ({ ...current, apiKey }));
                    return;
                  }
                  setProxyState(await api.proxy.regenerateApiKey());
                  setCodexAppStatus(await api.codexApp.getStatus());
                },
                { silentSuccess: true }
              )
            }
            onStart={(portText, apiKey) =>
              runAction(
                t("common.start"),
                async () => {
                  const port = parseProxyPort(portText);
                  if (port === undefined) {
                    throw new Error(t("error.proxy_runtime.invalid_port_format", { value: portText }));
                  }
                  if (!api) {
                    setProxyState((current) => ({ ...current, apiKey, isRunning: true, port, proxyURL: `http://localhost:${port}` }));
                    return;
                  }
                  setProxyState(await api.proxy.start(port, apiKey));
                  setCodexAppStatus(await api.codexApp.getStatus());
                },
                { success: t("proxy.notice.started") }
              )
            }
            onStop={() =>
              runAction(
                t("common.stop"),
                async () => {
                  if (!api) {
                    setProxyState((current) => ({ ...current, isRunning: false }));
                    setSelectedModel(proxyAvailableModels[0] ?? selectedModel);
                    return;
                  }
                  setProxyState(await api.proxy.stop());
                  setCodexAppStatus(await api.codexApp.getStatus());
                  setSelectedModel(proxyAvailableModels[0] ?? selectedModel);
                },
                { success: t("proxy.notice.stopped") }
              )
            }
            codexAppStatus={codexAppStatus}
            onConfigureCodexApp={() =>
              runAction(
                t("proxy.codex_app.configure"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  const status = await api.codexApp.configure();
                  setCodexAppStatus(status);
                  setProxyState(await api.proxy.getState());
                  setNotice({
                    tone: status.warning ? "info" : "success",
                    text: status.warning ?? t("notice.action_complete", { action: t("proxy.codex_app.configure") })
                  });
                },
                { silentSuccess: true }
              )
            }
            onRestoreCodexAppSafe={() =>
              runAction(
                t("proxy.codex_app.restore_safe"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  const status = await api.codexApp.restoreSafe();
                  setCodexAppStatus(status);
                  setNotice({ tone: status.warning ? "info" : "success", text: status.warning ?? t("notice.action_complete", { action: t("proxy.codex_app.restore_safe") }) });
                },
                { silentSuccess: true }
              )
            }
            onRestoreCodexAppSnapshot={() =>
              runAction(
                t("proxy.codex_app.restore_snapshot"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  const status = await api.codexApp.restoreSnapshot();
                  setCodexAppStatus(status);
                },
                { success: t("notice.action_complete", { action: t("proxy.codex_app.restore_snapshot") }) }
              )
            }
            proxyState={proxyState}
            selectedEndpoint={selectedEndpoint}
            selectedModel={selectedModel}
            setSelectedEndpoint={setSelectedEndpoint}
            setSelectedModel={setSelectedModel}
            t={t}
          />
        )}

        {activePage === "settings" && (
          <SettingsPage
            installedEditors={installedEditors}
            onOpenRepository={() =>
              runAction(
                t("settings.star_on_github"),
                async () => {
                  if (!api) {
                    window.open("https://github.com/meitianwang/CodexManager", "_blank", "noopener,noreferrer");
                    return;
                  }
                  await api.app.openRepository();
                },
                { silentSuccess: true }
              )
            }
            onQuit={() =>
              runAction(
                t("common.quit"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  await api.app.quit();
                },
                { silentSuccess: true }
              )
            }
            onUpdateSettings={(patch) => runAction(t("tab.settings"), () => updateSettings(patch), { success: settingsUpdateNotice(patch, t) })}
            settings={settings}
            t={t}
          />
        )}
      </section>
      {notice && (
        <div className="notice-host">
          <div className={`notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
            <span className={`notice-icon ${notice.tone}`} aria-hidden="true" />
            <span className="notice-text">{notice.text}</span>
            <span className="notice-close-icon" aria-hidden="true" />
          </div>
        </div>
      )}
      {transferDialog && (
        <AccountTransferSelectionDialog
          key={accountTransferDialogKey(transferDialog)}
          accounts={accountTransferDialogAccounts(transferDialog)}
          actionTitle={t(
            transferDialog.mode === "export" ? "accounts.transfer.export.action" : "accounts.transfer.import.action"
          )}
          initiallySelectedIds={new Set(accountTransferDialogAccounts(transferDialog).map((account) => account.id))}
          isBusy={Boolean(busyAction)}
          title={t(transferDialog.mode === "export" ? "accounts.transfer.export.title" : "accounts.transfer.import.title")}
          onCancel={() => setTransferDialog(undefined)}
          onConfirm={confirmAccountTransferSelection}
          t={t}
        />
      )}
    </main>
  );
}

interface AccountsPageProps {
  accounts: AccountSummary[];
  accountToolbarBusyAction?: AccountToolbarBusyAction;
  busyAction?: string;
  switchingAccountId?: string;
  contentState: AccountsContentState;
  onAddViaLogin: () => void;
  onDeleteAccount: (id: string) => void;
  onExportSelected: () => void;
  onImportCurrent: () => void;
  onImportPackage: () => void;
  onRefreshAll: () => void;
  onRefreshUsage: (id: string) => void;
  onSmartSwitch: () => void;
  onSwitchAccount: (id: string) => void;
  onWarmUpWeeklyQuota: () => void;
  locale: AppLocaleID;
  t: Translator;
}

function AccountsPage(props: AccountsPageProps): ReactElement {
  const [viewMode, setViewMode] = useState<AccountViewMode>("grid");
  const displayAccounts = useMemo(() => sortForDisplay(props.accounts), [props.accounts]);
  const isContentLoading = props.contentState.status === "loading";
  const isAccountActionDisabled = Boolean(props.busyAction) || isContentLoading || props.accounts.length === 0;
  const exportActionLabel =
    props.accountToolbarBusyAction === "export" ? props.t("accounts.action.exporting") : props.t("accounts.action.export");
  const importPackageActionLabel =
    props.accountToolbarBusyAction === "importPackage" ? props.t("accounts.action.importing") : props.t("accounts.action.import_package");
  const importCurrentActionLabel =
    props.accountToolbarBusyAction === "importCurrent" ? props.t("accounts.action.importing") : props.t("accounts.action.import_current");
  const addActionLabel =
    props.accountToolbarBusyAction === "add" ? props.t("accounts.action.waiting_for_login") : props.t("accounts.action.sign_in");
  const warmUpWeeklyQuotaActionLabel =
    props.accountToolbarBusyAction === "warmUpWeeklyQuota"
      ? props.t("accounts.action.warming_up_weekly_quota")
      : props.t("accounts.action.warm_weekly_quota");
  const isRefreshAllBusy = props.accountToolbarBusyAction === "refreshAll";

  return (
    <div className="accounts-layout">
      <div className="accounts-action-bar">
        <div className="accounts-action-title-row">
          <h2 className="page-title">{props.t("tab.accounts")}</h2>
          <div className="accounts-view-controls">
            <div className="segmented-control" role="group" aria-label={props.t("accounts.action.view_mode")}>
              <button
                aria-label={props.t("accounts.action.view_grid")}
                aria-pressed={viewMode === "grid"}
                title={props.t("accounts.action.view_grid")}
                type="button"
                onClick={() => setViewMode("grid")}
              >
                <SymbolIcon className="view-mode-icon grid-icon" name="grid" size={15} strokeWidth={2.7} />
              </button>
              <button
                aria-label={props.t("accounts.action.view_list")}
                aria-pressed={viewMode === "list"}
                title={props.t("accounts.action.view_list")}
                type="button"
                onClick={() => setViewMode("list")}
              >
                <SymbolIcon className="view-mode-icon list-icon" name="list" size={15} strokeWidth={2.7} />
              </button>
            </div>
          </div>
        </div>
        <div className="toolbar">
          <button
            aria-label={exportActionLabel}
            className="toolbar-action-button"
            title={exportActionLabel}
            type="button"
            onClick={props.onExportSelected}
            disabled={isAccountActionDisabled}
          >
            <ToolbarActionContent iconClassName="export-accounts-icon" iconName="squareAndArrowUp" label={exportActionLabel} />
          </button>
          <button
            aria-label={importPackageActionLabel}
            className="toolbar-action-button"
            title={importPackageActionLabel}
            type="button"
            onClick={props.onImportPackage}
            disabled={Boolean(props.busyAction)}
          >
            <ToolbarActionContent iconClassName="import-package-icon" iconName="trayAndArrowDown" label={importPackageActionLabel} />
          </button>
          <button
            aria-label={importCurrentActionLabel}
            className="toolbar-action-button"
            title={importCurrentActionLabel}
            type="button"
            onClick={props.onImportCurrent}
            disabled={Boolean(props.busyAction)}
          >
            <ToolbarActionContent iconClassName="import-current-icon" iconName="squareAndArrowDown" label={importCurrentActionLabel} />
          </button>
          <button
            aria-label={addActionLabel}
            className="toolbar-action-button primary-action"
            title={addActionLabel}
            type="button"
            onClick={props.onAddViaLogin}
            disabled={Boolean(props.busyAction)}
          >
            <ToolbarActionContent iconClassName="add-account-icon" iconName="plus" label={addActionLabel} />
          </button>
          <button
            className="toolbar-action-button"
            type="button"
            onClick={props.onSmartSwitch}
            disabled={isAccountActionDisabled}
          >
            <ToolbarActionContent iconClassName="smart-switch-action-icon" iconName="wandAndStars" label={props.t("accounts.action.smart_switch")} />
          </button>
          <button
            aria-label={warmUpWeeklyQuotaActionLabel}
            className="toolbar-action-button"
            title={warmUpWeeklyQuotaActionLabel}
            type="button"
            onClick={props.onWarmUpWeeklyQuota}
            disabled={isAccountActionDisabled}
          >
            <ToolbarActionContent iconClassName="warmup-action-icon" iconName="flame" label={warmUpWeeklyQuotaActionLabel} />
          </button>
          <button
            aria-label={props.t("accounts.action.refresh_usage")}
            className="icon-button"
            title={props.t("accounts.action.refresh_usage")}
            type="button"
            onClick={props.onRefreshAll}
            disabled={isAccountActionDisabled}
          >
            <SymbolIcon
              className={isRefreshAllBusy ? "toolbar-action-icon refresh-icon spinning" : "toolbar-action-icon refresh-icon"}
              name="refresh"
              size={18}
              strokeWidth={2.35}
            />
          </button>
        </div>
      </div>

      {props.contentState.status === "loading" ? (
        <div className="empty-state loading-state" role="status">
          <span className="empty-state-icon loading-icon" aria-hidden="true" />
          <h3>{props.t("accounts.loading.message")}</h3>
        </div>
      ) : props.contentState.status === "error" ? (
        <div className="empty-state error-state" role="alert">
          <span className="empty-state-icon error-state-icon" aria-hidden="true" />
          <h3>{props.t("accounts.error.load_failed")}</h3>
          <p>{props.contentState.message}</p>
        </div>
      ) : props.accounts.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon tray-icon" aria-hidden="true" />
          <h3>{props.t("accounts.empty.title")}</h3>
          <p>{props.t("accounts.empty.message")}</p>
        </div>
      ) : (
        <div className={viewMode === "grid" ? "account-list grid" : "account-list list"}>
          {displayAccounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              isSwitching={props.switchingAccountId === account.id}
              viewMode={viewMode}
              onDelete={() => props.onDeleteAccount(account.id)}
              onRefresh={() => props.onRefreshUsage(account.id)}
              onSwitch={() => props.onSwitchAccount(account.id)}
              locale={props.locale}
              t={props.t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface AccountRowProps {
  account: AccountSummary;
  isSwitching: boolean;
  onDelete: () => void;
  onRefresh: () => void;
  onSwitch: () => void;
  locale: AppLocaleID;
  t: Translator;
  viewMode: AccountViewMode;
}

function AccountRow({ account, isSwitching, locale, onDelete, onRefresh, onSwitch, t, viewMode }: AccountRowProps): ReactElement {
  const accountTitle = fullAccountName(account);
  const workspaceTag = account.shouldDisplayWorkspaceTag ? account.displayTeamName : undefined;
  const switchToThisLabel = t("accounts.card.switch_to_this");
  const refreshUsageLabel = t("common.refresh_usage");

  return (
    <article
      className={accountCardClassName(account.isCurrent, viewMode)}
    >
      <div className="account-main">
        <div className="account-card-header">
          <span className={`badge plan ${planBadgeClassName(account.normalizedPlanLabel)}`}>{account.normalizedPlanLabel}</span>
          <span className="header-spacer" />
          {account.isCurrent ? (
            <span className="badge current-badge">{t("accounts.card.current")}</span>
          ) : (
            <span className="ellipsis-icon" aria-hidden="true">...</span>
          )}
        </div>
        <div className="account-title-line">
          <h3>{accountTitle}</h3>
        </div>
        {workspaceTag && <p className="workspace-name">{workspaceTag}</p>}
      </div>
      <UsageCell tone="success" title={t("accounts.window.five_hour")} usedPercent={account.usage?.fiveHour?.usedPercent} t={t} />
      <UsageCell tone="info" title={t("accounts.window.weekly")} usedPercent={account.usage?.oneWeek?.usedPercent} t={t} />
      <ResetCell
        fiveHourResetAt={account.usage?.fiveHour?.resetAt}
        locale={locale}
        oneWeekResetAt={account.usage?.oneWeek?.resetAt}
        t={t}
      />
      {account.usageError && <p className="usage-error">{account.usageError}</p>}
      <div className="account-actions">
        <button
          aria-label={switchToThisLabel}
          className="account-action-button"
          disabled={account.isCurrent || isSwitching}
          title={switchToThisLabel}
          type="button"
          onClick={onSwitch}
        >
          {isSwitching ? (
            <span className="account-action-icon loading-icon" aria-hidden="true" />
          ) : (
            <>
              <SymbolIcon className="account-action-icon switch-icon" name="switch" size={14} strokeWidth={2.3} />
              <span>Switch</span>
            </>
          )}
        </button>
        <button aria-label={refreshUsageLabel} className="account-action-button" title={refreshUsageLabel} type="button" onClick={onRefresh}>
          <SymbolIcon className="account-action-icon refresh-icon" name="refresh" size={14} strokeWidth={2.3} />
          <span>{t("common.refresh")}</span>
        </button>
        <button className="account-action-button danger" type="button" onClick={onDelete}>
          <SymbolIcon className="account-action-icon trash-icon" name="trash" size={14} strokeWidth={2.3} />
          <span>Delete</span>
        </button>
      </div>
    </article>
  );
}

function accountCardClassName(isCurrent: boolean, viewMode: AccountViewMode): string {
  return [
    "account-row",
    viewMode,
    isCurrent ? "current" : ""
  ].filter(Boolean).join(" ");
}

function planBadgeClassName(planLabel: string): string {
  switch (planLabel.trim().toUpperCase()) {
    case "PLUS":
      return "plus-plan";
    case "FREE":
      return "free-plan";
    case "ENTERPRISE":
    case "BUSINESS":
      return "enterprise-plan";
    case "PRO":
      return "pro-plan";
    default:
      return "team-plan";
  }
}

function fullAccountName(account: AccountSummary): string {
  return (account.email ?? account.accountId).trim();
}

function AccountTransferSelectionDialog({
  accounts,
  actionTitle,
  initiallySelectedIds,
  isBusy,
  onCancel,
  onConfirm,
  t,
  title
}: {
  accounts: AccountTransferSelectableItem[];
  actionTitle: string;
  initiallySelectedIds: ReadonlySet<string>;
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: (selectedIds: Set<string>) => void;
  t: Translator;
  title: string;
}): ReactElement {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(initiallySelectedIds));
  const allSelected = selectedIds.size === accounts.length && accounts.length > 0;

  return (
    <div className="transfer-backdrop">
      <section className="transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-dialog-title">
        <header className="transfer-header">
          <button aria-label={t("common.cancel")} className="transfer-close" type="button" onClick={onCancel}>
            x
          </button>
          <div>
            <h3 id="transfer-dialog-title">{title}</h3>
            <p>{t("accounts.transfer.account_count_format", { count: accounts.length })}</p>
          </div>
          <div className="transfer-header-actions">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set(accounts.map((account) => account.id)))}
              disabled={allSelected || isBusy}
            >
              {t("common.select_all")}
            </button>
            <button type="button" onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0 || isBusy}>
              {t("common.deselect_all")}
            </button>
          </div>
        </header>

        <div className="transfer-list">
          {accounts.map((account) => (
            <label key={account.id} className="transfer-row">
              <input
                aria-label={`${t("accounts.status.selected")} ${account.label}`}
                checked={selectedIds.has(account.id)}
                type="checkbox"
                onChange={() => setSelectedIds((current) => toggleSetValue(current, account.id))}
              />
              <span className="transfer-account">
                <strong>{account.email ?? account.label}</strong>
                <span>{account.teamName ?? account.accountId}</span>
              </span>
              <span className="transfer-plan">{account.planLabel}</span>
              {account.isCurrent && <span className="badge current-badge">{t("accounts.card.current")}</span>}
            </label>
          ))}
        </div>

        <footer className="transfer-footer">
          <button type="button" onClick={onCancel} disabled={isBusy}>
            {t("common.cancel")}
          </button>
          <button
            className="primary-action"
            type="button"
            onClick={() => onConfirm(new Set(selectedIds))}
            disabled={isBusy || selectedIds.size === 0}
          >
            {actionTitle}
          </button>
        </footer>
      </section>
    </div>
  );
}

type QuotaRingStyle = CSSProperties & {
  "--quota-progress": string;
};

function UsageCell({
  title,
  tone,
  usedPercent,
  t
}: {
  title: string;
  tone: "success" | "info";
  usedPercent?: number;
  t: Translator;
}): ReactElement {
  const used = usedPercent !== undefined && Number.isFinite(usedPercent) ? clampPercent(usedPercent) : 100;
  const remaining = Math.max(0, 100 - used);
  const remainingText = `${Math.round(remaining)}%`;
  const usedText = t("accounts.usage.used_percent", { percent: `${Math.round(used)}%` });
  return (
    <div className={`usage-cell quota-ring-card ${tone}`}>
      <div className="quota-ring" style={quotaRingStyle(remaining)}>
        <div className="quota-ring-center">
          <span>{compactWindowTitle(title)}</span>
          <strong>{remainingText}</strong>
        </div>
      </div>
      <small>{usedText}</small>
    </div>
  );
}

function quotaRingStyle(remainingPercent: number): QuotaRingStyle {
  return {
    "--quota-progress": `${Math.max(0, Math.min(100, remainingPercent))}%`
  };
}

function compactWindowTitle(title: string): string {
  return title === "1 week" ? "1w" : title;
}

function ResetCell({
  fiveHourResetAt,
  locale,
  oneWeekResetAt,
  t
}: {
  fiveHourResetAt?: number;
  locale: AppLocaleID;
  oneWeekResetAt?: number;
  t: Translator;
}): ReactElement {
  return (
    <div className="reset-cell">
      <span className="reset-title">{t("accounts.window.reset_header")}</span>
      <ResetRow resetAt={fiveHourResetAt} title={t("accounts.window.five_hour")} locale={locale} t={t} />
      <ResetRow resetAt={oneWeekResetAt} title={t("accounts.window.weekly")} locale={locale} t={t} />
    </div>
  );
}

function ResetRow({ locale, resetAt, t, title }: { locale: AppLocaleID; resetAt?: number; t: Translator; title: string }): ReactElement {
  const value = formatResetAt(resetAt, locale);
  return (
    <div className="reset-row" title={t("accounts.window.reset_at_format", { value })}>
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface ProxyPageProps {
  busyAction?: string;
  codexAppStatus: CodexAppIntegrationStatus;
  hasAccounts: boolean;
  onConfigureCodexApp: () => void;
  onCopy: (text: string, success?: string) => void;
  onRegenerateApiKey: () => void;
  onRestoreCodexAppSafe: () => void;
  onRestoreCodexAppSnapshot: () => void;
  onStart: (port: string, apiKey: string) => void;
  onStop: () => void;
  proxyState: ProxyRuntimeState;
  selectedEndpoint: ProxyEndpointID;
  selectedModel: string;
  setSelectedEndpoint: (id: ProxyEndpointID) => void;
  setSelectedModel: (model: string) => void;
  t: Translator;
}

function ProxyPage(props: ProxyPageProps): ReactElement {
  const [port, setPort] = useState(String(props.proxyState.port));
  const [apiKey, setApiKey] = useState(props.proxyState.apiKey);

  useEffect(() => {
    setPort(String(props.proxyState.port));
    setApiKey(props.proxyState.apiKey);
  }, [props.proxyState.apiKey, props.proxyState.port]);

  const endpoint = proxyEndpoints.find((candidate) => candidate.id === props.selectedEndpoint) ?? proxyEndpoints[0];
  if (!endpoint) {
    throw new Error("Proxy endpoints are not configured");
  }
  const apiKeyDisplay = props.proxyState.isRunning ? apiKey : "sk-local-...";
  const curlText = proxyCurlExample(props.proxyState.proxyURL, endpoint.id, props.selectedModel, apiKeyDisplay);
  const configText = proxyConfigText(props.proxyState.proxyURL, endpoint.id, apiKeyDisplay);
  const isBusy = Boolean(props.busyAction);
  const codexAppConfigureDisabled = isBusy || !props.hasAccounts;
  const codexAppHint = props.hasAccounts ? props.t("proxy.codex_app.restart_hint") : props.t("proxy.codex_app.no_accounts_hint");

  return (
    <div className="proxy-layout">
      <h2 className="page-title">{props.t("tab.proxy")}</h2>

      <section className={props.proxyState.isRunning ? "proxy-section proxy-control-section running" : "proxy-section proxy-control-section"}>
        <h3>{props.t("proxy.section.control")}</h3>
        <div className="proxy-control">
          <div className={props.proxyState.isRunning ? "status-pill running" : "status-pill"}>
            <span />
            {props.proxyState.isRunning ? props.t("proxy.status.running") : props.t("proxy.status.stopped")}
          </div>
          <label className="proxy-form-row proxy-port-row">
            <span>{props.t("proxy.port")}</span>
            <input disabled={props.proxyState.isRunning} inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} />
          </label>
          <div className="proxy-form-row api-key-field">
            <label htmlFor="proxy-api-key">{props.t("proxy.api_key")}</label>
            <span className="api-key-control">
              <input
                disabled={props.proxyState.isRunning}
                id="proxy-api-key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <button
                aria-label={props.t("proxy.api_key.regenerate")}
                className="icon-button regenerate-api-key-button"
                disabled={props.proxyState.isRunning || isBusy}
                title={props.t("proxy.api_key.regenerate")}
                type="button"
                onClick={props.onRegenerateApiKey}
              >
                <span className="regenerate-icon" aria-hidden="true" />
              </button>
            </span>
          </div>
          <div className="proxy-actions">
            {props.proxyState.isRunning ? (
              <>
                <button className="danger" type="button" disabled={isBusy} onClick={props.onStop}>
                  {props.t("common.stop")}
                </button>
                <button type="button" disabled={isBusy} onClick={() => props.onCopy(props.proxyState.proxyURL, props.t("proxy.notice.url_copied"))}>
                  {props.t("proxy.copy_url")}
                </button>
              </>
            ) : (
              <button
                className="primary-action"
                type="button"
                disabled={isBusy}
                onClick={() => props.onStart(port, apiKey)}
              >
                {props.t("common.start")}
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="split-region">
        <section className="proxy-section">
          <h3>{props.t("proxy.section.endpoints")}</h3>
          <div className="endpoint-list">
            {proxyEndpoints.map((item) => (
              <button
                key={item.id}
                className={item.id === props.selectedEndpoint ? "endpoint-row selected" : "endpoint-row"}
                type="button"
                onClick={() => props.setSelectedEndpoint(item.id)}
              >
                <span className="endpoint-method-badge">{item.method}</span>
                <code>{item.path}</code>
                <em>{proxyEndpointDescription(item.id, props.t)}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="proxy-section">
          <h3>{props.t("proxy.section.models")}</h3>
          <div className="model-list">
            {props.proxyState.availableModels.map((model) => (
              <button
                key={model}
                className={model === props.selectedModel ? "model-chip selected" : "model-chip"}
                type="button"
                onClick={() => props.setSelectedModel(model)}
              >
                {model}
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="proxy-section">
        <h3>{props.t("proxy.section.usage")}</h3>
        <CodeBlock label={props.t("proxy.usage.curl_example")} text={curlText} onCopy={() => props.onCopy(curlText)} t={props.t} />
        <CodeBlock label={props.t("proxy.usage.config_hint")} text={configText} onCopy={() => props.onCopy(configText)} t={props.t} />
      </section>

      <section className="proxy-section codex-app-section">
        <div className="codex-app-summary">
          <div className="codex-app-copy">
            <div className="codex-app-title-row">
              <h3>{props.t("proxy.section.codex_app")}</h3>
              <span className={`integration-status ${props.codexAppStatus.state}`}>
                {codexAppStatusLabel(props.codexAppStatus.state, props.t)}
              </span>
            </div>
            <p className="codex-app-hint">{codexAppHint}</p>
          </div>
          <div className="codex-app-actions">
            <button className="primary-action" type="button" disabled={codexAppConfigureDisabled} onClick={props.onConfigureCodexApp}>
              {props.t("proxy.codex_app.configure")}
            </button>
            <button type="button" disabled={isBusy || !props.codexAppStatus.hasBackup} onClick={props.onRestoreCodexAppSafe}>
              {props.t("proxy.codex_app.restore_safe")}
            </button>
            <button className="danger subtle-danger" type="button" disabled={isBusy || !props.codexAppStatus.hasBackup} onClick={props.onRestoreCodexAppSnapshot}>
              {props.t("proxy.codex_app.restore_snapshot")}
            </button>
          </div>
        </div>
        <div className="codex-app-details">
          <span>{props.t("proxy.codex_app.provider_model_format", { provider: props.codexAppStatus.providerId, model: props.codexAppStatus.model })}</span>
          <span>{props.t("proxy.codex_app.config_path_format", { path: props.codexAppStatus.configPath })}</span>
          <span>{props.t("proxy.codex_app.proxy_format", { url: props.codexAppStatus.proxyURL })}</span>
        </div>
        {props.codexAppStatus.warning && <p className="integration-warning">{props.codexAppStatus.warning}</p>}
      </section>
    </div>
  );
}

function CodeBlock({ label, text, onCopy, t }: { label: string; text: string; onCopy: () => void; t: Translator }): ReactElement {
  return (
    <section className="code-block">
      <div>
        <span>{label}</span>
        <button aria-label={t("common.copy")} className="code-copy-button" title={t("common.copy")} type="button" onClick={onCopy}>
          <span className="copy-doc-icon" aria-hidden="true" />
        </button>
      </div>
      <pre>{text}</pre>
    </section>
  );
}

interface SettingsPageProps {
  installedEditors: InstalledEditorApp[];
  onOpenRepository: () => void;
  onQuit: () => void;
  onUpdateSettings: (patch: AppSettingsPatch) => void;
  settings: AppSettings;
  t: Translator;
}

function SettingsPage({ installedEditors, onOpenRepository, onQuit, onUpdateSettings, settings, t }: SettingsPageProps): ReactElement {
  const localeOptions = appLocales.map((locale) => ({ id: locale, label: t(languageNameKey(locale)) }));
  const selectedRestartEditorTarget = settings.restartEditorTargets[0] ?? "";
  const updateRestartEditorsOnSwitch = (value: boolean) => {
    if (!value || settings.restartEditorTargets.length > 0) {
      onUpdateSettings({ restartEditorsOnSwitch: value });
      return;
    }

    const firstInstalledEditor = installedEditors[0]?.id;
    onUpdateSettings({
      restartEditorsOnSwitch: true,
      restartEditorTargets: firstInstalledEditor ? [firstInstalledEditor] : []
    });
  };

  return (
    <div className="settings-layout">
      <h2 className="page-title">{t("tab.settings")}</h2>

      <section className="settings-section">
        <h3>{t("settings.section.general")}</h3>
        <ToggleRow
          checked={settings.launchAtStartup}
          label={t("settings.launch_at_startup")}
          onChange={(value) => onUpdateSettings({ launchAtStartup: value })}
        />
        <ToggleRow
          checked={settings.launchCodexAfterSwitch}
          label={t("settings.launch_codex_after_switch")}
          onChange={(value) => onUpdateSettings({ launchCodexAfterSwitch: value })}
        />
        <ToggleRow
          checked={settings.autoStartProxy}
          label={t("settings.auto_start_proxy")}
          onChange={(value) => onUpdateSettings({ autoStartProxy: value })}
        />
      </section>

      <section className="settings-section">
        <h3>{t("settings.section.switch_behavior")}</h3>
        <ToggleRow
          checked={settings.autoSmartSwitch}
          label={t("settings.auto_smart_switch")}
          onChange={(value) => onUpdateSettings({ autoSmartSwitch: value })}
        />
        <ToggleRow
          checked={settings.restartEditorsOnSwitch}
          label={t("settings.restart_editors_on_switch")}
          onChange={updateRestartEditorsOnSwitch}
        />
        <label className="select-row">
          <span>{t("settings.editor_restart_target")}</span>
          <select
            aria-label={t("settings.editor_restart_target")}
            disabled={!settings.restartEditorsOnSwitch || installedEditors.length === 0}
            value={selectedRestartEditorTarget}
            onChange={(event) =>
              onUpdateSettings({
                restartEditorTargets: event.target.value ? [event.target.value as EditorAppID] : []
              })
            }
          >
            <option value="">{t("common.none")}</option>
            {installedEditors.map((editor) => (
              <option key={editor.id} value={editor.id}>
                {editor.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="settings-section">
        <h3>{t("settings.section.language")}</h3>
        <label className="select-row">
          <span>{t("settings.language")}</span>
          <select aria-label={t("settings.language")} value={settings.locale} onChange={(event) => onUpdateSettings({ locale: event.target.value })}>
            {localeOptions.map((locale) => (
              <option key={locale.id} value={locale.id}>
                {locale.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <footer className="settings-footer">
        <button className="settings-footer-link" type="button" onClick={onOpenRepository}>
          <span className="settings-footer-icon github-star-icon" aria-hidden="true" />
          <span>{t("settings.star_on_github")}</span>
        </button>
        <button className="danger" type="button" onClick={onQuit}>
          {t("common.quit")}
        </button>
      </footer>
    </div>
  );
}

function ToggleRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }): ReactElement {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function fallbackProxyState(settings: AppSettings): ProxyRuntimeState {
  return {
    apiKey: settings.proxyApiKey || generateProxyApiKey(),
    availableModels: [...proxyAvailableModels],
    isRunning: false,
    port: settings.proxyPort,
    proxyURL: `http://localhost:${settings.proxyPort}`
  };
}

function fallbackCodexAppStatus(proxyState: ProxyRuntimeState): CodexAppIntegrationStatus {
  return {
    configPath: "~/.codex/config.toml",
    hasBackup: false,
    model: codexAppDefaultModel,
    providerId: codexAppProviderId,
    proxyURL: proxyState.proxyURL.replace("localhost", "127.0.0.1"),
    state: "not_configured"
  };
}

function codexAppStatusLabel(state: CodexAppIntegrationStatus["state"], t: Translator): string {
  switch (state) {
    case "configured":
      return t("proxy.codex_app.status_configured");
    case "drifted":
      return t("proxy.codex_app.status_drifted");
    case "restorable":
      return t("proxy.codex_app.status_restorable");
    case "not_configured":
      return t("proxy.codex_app.status_not_configured");
  }
}

function accountSummaryToTransferSelectableItem(account: AccountSummary): AccountTransferSelectableItem {
  return {
    id: account.id,
    label: account.label,
    email: account.email,
    accountId: account.accountId,
    planLabel: account.normalizedPlanLabel,
    teamName: account.displayTeamName,
    isCurrent: account.isCurrent
  };
}

function accountTransferDialogAccounts(dialog: AccountTransferDialogState): AccountTransferSelectableItem[] {
  return dialog.mode === "export" ? dialog.accounts : dialog.draft.accounts;
}

function accountTransferDialogKey(dialog: AccountTransferDialogState): string {
  return dialog.mode === "export" ? "export" : `import-${dialog.draft.draftId}`;
}

function toggleSetValue(values: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function clampPercent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function formatResetAt(epochSeconds: number | undefined, locale: AppLocaleID): string {
  if (epochSeconds === undefined || !Number.isFinite(epochSeconds)) {
    return "--";
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(new Date(epochSeconds * 1000));
}

function proxyCurlExample(baseURL: string, endpoint: ProxyEndpointID, model: string, apiKey: string): string {
  switch (endpoint) {
    case "responses":
      return `curl ${baseURL}/v1/responses \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -d '{"model":"${model}","instructions":"You are a helpful assistant.","input":"Hello"}'`;
    case "messages":
      return `curl ${baseURL}/v1/messages \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: ${apiKey}" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -d '{"model":"${model}","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'`;
    case "chatCompletions":
      return `curl ${baseURL}/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`;
  }
}

function proxyConfigText(baseURL: string, endpoint: ProxyEndpointID, apiKey: string): string {
  if (endpoint === "messages") {
    return `ANTHROPIC_BASE_URL=${baseURL}\nANTHROPIC_API_KEY=${apiKey}`;
  }
  return `OPENAI_BASE_URL=${baseURL}/v1\nOPENAI_API_KEY=${apiKey}`;
}

function parseProxyPort(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return undefined;
  }
  return port;
}

function proxyEndpointDescription(endpoint: ProxyEndpointID, t: Translator): string {
  switch (endpoint) {
    case "chatCompletions":
      return t("proxy.endpoint.chat_completions");
    case "responses":
      return t("proxy.endpoint.responses");
    case "messages":
      return t("proxy.endpoint.messages");
  }
}

function settingsUpdateNotice(patch: AppSettingsPatch, t: Translator): string {
  if (patch.restartEditorTargets !== undefined && Object.keys(patch).length === 1) {
    return t("settings.notice.restart_target_updated");
  }
  return t("settings.notice.updated");
}

function weeklyWarmupNotice(result: WeeklyQuotaWarmupResult, t: Translator): string {
  if (result.targetCount === 0) {
    return t("accounts.notice.weekly_no_targets");
  }
  if (result.failures.length === 0) {
    return t("accounts.notice.weekly_complete", { succeeded: result.succeededCount, failed: result.failures.length });
  }
  return t("accounts.notice.weekly_partial", { succeeded: result.succeededCount, failed: result.failures.length });
}

function weeklyWarmupNoticeTone(result: WeeklyQuotaWarmupResult): NoticeTone {
  if (result.targetCount === 0) {
    return "info";
  }
  return result.failures.length === 0 ? "success" : "error";
}

function smartSwitchNotice(account: AccountSummary, execution: SwitchAccountExecutionResult, t: Translator): Notice {
  const notice = switchNotice(execution, t);
  return {
    tone: notice.tone,
    text: t("accounts.notice.smart_switched_prefix_format", { account: account.label, message: notice.text })
  };
}

function switchNotice(execution: SwitchAccountExecutionResult, t: Translator): Notice {
  let tone: NoticeTone = "success";
  const segments = [t(execution.usedFallbackCLI ? "accounts.notice.switch_done_fallback" : "accounts.notice.switch_done")];

  if (execution.usedFallbackCLI) {
    tone = "info";
  }

  if (execution.editorRestartError) {
    tone = "error";
    segments.push(t("accounts.notice.editor_restart_failed_format", { message: execution.editorRestartError }));
  } else if (execution.restartedEditorApps.length > 0) {
    segments.push(t("accounts.notice.editor_restarted_format", { editors: execution.restartedEditorApps.join(" / ") }));
  }

  return { tone, text: segments.join(" · ") };
}

export default App;
