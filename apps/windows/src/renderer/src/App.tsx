import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { appInfo as fallbackAppInfo, type AppInfo } from "@shared/app-info";
import { sortByRemaining } from "@shared/domain/account-ranking";
import type { AccountsImportDraftDescriptor, AccountTransferSelectableItem } from "@shared/models/account-transfer";
import type { AccountSummary, WeeklyQuotaWarmupResult } from "@shared/models/accounts";
import type { InstalledEditorApp, SwitchAccountExecutionResult } from "@shared/models/app";
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
type NoticeTone = "success" | "error" | "info";
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

function ToolbarActionContent({ iconClassName, label }: { iconClassName: string; label: string }): ReactElement {
  return (
    <>
      <span className={`toolbar-action-icon ${iconClassName}`} aria-hidden="true" />
      <span>{label}</span>
    </>
  );
}

function App(): ReactElement {
  const api = window.codexManager;
  const [activePage, setActivePage] = useState<PageID>("accounts");
  const [appInfo, setAppInfo] = useState<AppInfo>(fallbackAppInfo);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [transferDialog, setTransferDialog] = useState<AccountTransferDialogState | undefined>();
  const [settings, setSettings] = useState<AppSettings>(() => defaultAppSettings());
  const [installedEditors, setInstalledEditors] = useState<InstalledEditorApp[]>([]);
  const [proxyState, setProxyState] = useState<ProxyRuntimeState>(() => fallbackProxyState(settings));
  const [selectedEndpoint, setSelectedEndpoint] = useState<ProxyEndpointID>("chatCompletions");
  const [selectedModel, setSelectedModel] = useState<string>("gpt-5");
  const [notice, setNotice] = useState<Notice | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();
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
    async (label: string, action: () => Promise<void>, options: { silentSuccess?: boolean; success?: string } = {}) => {
      setBusyAction(label);
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
      }
    },
    [t]
  );

  const loadData = useCallback(async () => {
    if (!api) {
      return;
    }
    const [nextInfo, nextAccounts, nextSettings, nextEditors, nextProxy] = await Promise.all([
      api.getAppInfo(),
      api.accounts.list(),
      api.settings.get(),
      api.settings.listEditors(),
      api.proxy.getState()
    ]);
    setAppInfo(nextInfo);
    setAccounts(nextAccounts);
    setSettings(nextSettings);
    setInstalledEditors(nextEditors);
    setProxyState(nextProxy);
    setSelectedModel((current) => (nextProxy.availableModels.includes(current) ? current : nextProxy.availableModels[0] ?? current));
  }, [api]);

  useEffect(() => {
    void loadData().catch((error: unknown) => {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
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
          { silentSuccess: true }
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
        { silentSuccess: true }
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
          <div className="brand-mark" aria-hidden="true">&lt;/&gt;</div>
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
              <span className={`nav-icon ${page.id}-nav-icon`} aria-hidden="true" />
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
            busyAction={busyAction}
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
                { silentSuccess: true }
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
                  setNotice({ tone: "success", text: t("accounts.notice.account_deleted") });
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
                { silentSuccess: true }
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
                { silentSuccess: true }
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
                  setNotice({ tone: "success", text: t("accounts.notice.accounts_refreshed") });
                },
                { silentSuccess: true }
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
                  setNotice({ tone: result.failures.length > 0 ? "info" : "success", text: weeklyWarmupNotice(result, t) });
                },
                { silentSuccess: true }
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
                  setNotice({ tone: "success", text: t("accounts.notice.usage_refreshed") });
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
                { silentSuccess: true }
              )
            }
            onUpdateAlias={(id, alias) =>
              runAction(
                t("accounts.card.team_alias"),
                async () => {
                  if (!api) {
                    throw new Error(t("error.ipc_bridge_unavailable"));
                  }
                  const updated = await api.accounts.updateTeamAlias(id, alias);
                  setAccounts((current) => current.map((account) => (account.id === id ? updated : account)));
                  setNotice({ tone: "success", text: t("accounts.notice.team_name_updated") });
                },
                { silentSuccess: true }
              )
            }
            locale={settings.locale}
            t={t}
          />
        )}

        {activePage === "proxy" && (
          <ProxyPage
            busyAction={busyAction}
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
                },
                { silentSuccess: true }
              )
            }
            onStart={(port, apiKey) =>
              runAction(
                t("common.start"),
                async () => {
                  if (!api) {
                    setProxyState((current) => ({ ...current, apiKey, isRunning: true, port, proxyURL: `http://localhost:${port}` }));
                    return;
                  }
                  setProxyState(await api.proxy.start(port, apiKey));
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
                    return;
                  }
                  setProxyState(await api.proxy.stop());
                },
                { success: t("proxy.notice.stopped") }
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
  busyAction?: string;
  onAddViaLogin: () => void;
  onDeleteAccount: (id: string) => void;
  onExportSelected: () => void;
  onImportCurrent: () => void;
  onImportPackage: () => void;
  onRefreshAll: () => void;
  onRefreshUsage: (id: string) => void;
  onSmartSwitch: () => void;
  onSwitchAccount: (id: string) => void;
  onUpdateAlias: (id: string, alias?: string) => void;
  onWarmUpWeeklyQuota: () => void;
  locale: AppLocaleID;
  t: Translator;
}

function AccountsPage(props: AccountsPageProps): ReactElement {
  const [viewMode, setViewMode] = useState<AccountViewMode>("grid");
  const [collapsedAccountIds, setCollapsedAccountIds] = useState<Set<string>>(new Set());
  const accountIds = useMemo(() => props.accounts.map((account) => account.id), [props.accounts]);
  const areAllAccountsCollapsed = accountIds.length > 0 && accountIds.every((id) => collapsedAccountIds.has(id));

  useEffect(() => {
    setCollapsedAccountIds((current) => {
      const availableIds = new Set(accountIds);
      return new Set([...current].filter((id) => availableIds.has(id)));
    });
  }, [accountIds]);

  const toggleCollapseAll = useCallback(() => {
    setCollapsedAccountIds((current) => {
      if (accountIds.length === 0) {
        return new Set();
      }
      return accountIds.every((id) => current.has(id)) ? new Set() : new Set(accountIds);
    });
  }, [accountIds]);

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
                <span className="view-mode-icon grid-icon" aria-hidden="true" />
              </button>
              <button
                aria-label={props.t("accounts.action.view_list")}
                aria-pressed={viewMode === "list"}
                title={props.t("accounts.action.view_list")}
                type="button"
                onClick={() => setViewMode("list")}
              >
                <span className="view-mode-icon list-icon" aria-hidden="true" />
              </button>
            </div>
            <button
              aria-label={props.t(areAllAccountsCollapsed ? "accounts.action.expand_all" : "accounts.action.collapse_all")}
              className="icon-button"
              title={props.t(areAllAccountsCollapsed ? "accounts.action.expand_all" : "accounts.action.collapse_all")}
              type="button"
              onClick={toggleCollapseAll}
              disabled={props.accounts.length === 0}
            >
              <span className={areAllAccountsCollapsed ? "chevron-icon down" : "chevron-icon up"} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="toolbar">
          <button
            className="toolbar-action-button"
            type="button"
            onClick={props.onExportSelected}
            disabled={Boolean(props.busyAction) || props.accounts.length === 0}
          >
            <ToolbarActionContent iconClassName="export-accounts-icon" label={props.t("accounts.action.export")} />
          </button>
          <button className="toolbar-action-button" type="button" onClick={props.onImportPackage} disabled={Boolean(props.busyAction)}>
            <ToolbarActionContent iconClassName="import-package-icon" label={props.t("accounts.action.import_package")} />
          </button>
          <button className="toolbar-action-button" type="button" onClick={props.onImportCurrent} disabled={Boolean(props.busyAction)}>
            <ToolbarActionContent iconClassName="import-current-icon" label={props.t("accounts.action.import_current")} />
          </button>
          <button className="toolbar-action-button primary-action" type="button" onClick={props.onAddViaLogin} disabled={Boolean(props.busyAction)}>
            <ToolbarActionContent iconClassName="add-account-icon" label={props.t("accounts.action.sign_in")} />
          </button>
          <button
            className="toolbar-action-button"
            type="button"
            onClick={props.onSmartSwitch}
            disabled={Boolean(props.busyAction) || props.accounts.length === 0}
          >
            <ToolbarActionContent iconClassName="smart-switch-action-icon" label={props.t("accounts.action.smart_switch")} />
          </button>
          <button
            className="toolbar-action-button"
            type="button"
            onClick={props.onWarmUpWeeklyQuota}
            disabled={Boolean(props.busyAction) || props.accounts.length === 0}
          >
            <ToolbarActionContent iconClassName="warmup-action-icon" label={props.t("accounts.action.warm_weekly_quota")} />
          </button>
          <button
            aria-label={props.t("accounts.action.refresh_usage")}
            className="icon-button"
            title={props.t("accounts.action.refresh_usage")}
            type="button"
            onClick={props.onRefreshAll}
            disabled={Boolean(props.busyAction) || props.accounts.length === 0}
          >
            <span className="toolbar-action-icon refresh-icon" aria-hidden="true" />
          </button>
        </div>
      </div>

      {props.accounts.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon tray-icon" aria-hidden="true" />
          <h3>{props.t("accounts.empty.title")}</h3>
          <p>{props.t("accounts.empty.message")}</p>
        </div>
      ) : (
        <div className={viewMode === "grid" ? "account-list grid" : "account-list list"}>
          {props.accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              isCollapsed={collapsedAccountIds.has(account.id)}
              viewMode={viewMode}
              onDelete={() => props.onDeleteAccount(account.id)}
              onRefresh={() => props.onRefreshUsage(account.id)}
              onSwitch={() => props.onSwitchAccount(account.id)}
              onUpdateAlias={(alias) => props.onUpdateAlias(account.id, alias)}
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
  isCollapsed: boolean;
  onDelete: () => void;
  onRefresh: () => void;
  onSwitch: () => void;
  onUpdateAlias: (alias?: string) => void;
  locale: AppLocaleID;
  t: Translator;
  viewMode: AccountViewMode;
}

function AccountRow({ account, isCollapsed, locale, onDelete, onRefresh, onSwitch, onUpdateAlias, t, viewMode }: AccountRowProps): ReactElement {
  const [alias, setAlias] = useState(account.teamAlias ?? "");
  const [isCollapsedSwitchOverlayVisible, setCollapsedSwitchOverlayVisible] = useState(false);
  useEffect(() => {
    setAlias(account.teamAlias ?? "");
  }, [account.teamAlias]);

  const canShowCollapsedSwitchOverlay = isCollapsed && !account.isCurrent;
  const accountTitle = isCollapsed ? shortAccountName(account) : fullAccountName(account);
  const workspaceTag = account.shouldDisplayWorkspaceTag ? account.displayTeamName : undefined;
  useEffect(() => {
    if (!canShowCollapsedSwitchOverlay) {
      setCollapsedSwitchOverlayVisible(false);
    }
  }, [canShowCollapsedSwitchOverlay]);

  const showCollapsedSwitchOverlay = () => {
    if (canShowCollapsedSwitchOverlay) {
      setCollapsedSwitchOverlayVisible(true);
    }
  };

  const hideCollapsedSwitchOverlay = () => {
    setCollapsedSwitchOverlayVisible(false);
  };

  return (
    <article
      aria-label={canShowCollapsedSwitchOverlay ? accountTitle : undefined}
      className={accountCardClassName(account.isCurrent, isCollapsed, viewMode, isCollapsedSwitchOverlayVisible)}
      tabIndex={canShowCollapsedSwitchOverlay ? 0 : undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          hideCollapsedSwitchOverlay();
        }
      }}
      onFocus={showCollapsedSwitchOverlay}
      onMouseEnter={showCollapsedSwitchOverlay}
      onMouseLeave={hideCollapsedSwitchOverlay}
    >
      <div className="account-main">
        {isCollapsed ? (
          <div className="account-compact-header">
            <div className="account-tag-line">
              <span className={`badge plan compact-plan ${planBadgeClassName(account.normalizedPlanLabel)}`}>
                {account.normalizedPlanLabel}
              </span>
              {workspaceTag && (
                <span className={`badge plan muted compact-plan ${planBadgeClassName(account.normalizedPlanLabel)}`}>{workspaceTag}</span>
              )}
            </div>
            <h3>{accountTitle}</h3>
          </div>
        ) : (
          <>
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
            <div className="alias-line">
              <input
                aria-label={`${t("accounts.card.team_alias")} ${account.label}`}
                placeholder={t("accounts.card.team_alias")}
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                onBlur={() => onUpdateAlias(alias)}
              />
            </div>
          </>
        )}
      </div>
      {isCollapsed ? (
        <div className="compact-usage-row">
          <UsageCell compact tone="success" title={t("accounts.window.five_hour")} usedPercent={account.usage?.fiveHour?.usedPercent} t={t} />
          <UsageCell compact tone="info" title={t("accounts.window.weekly")} usedPercent={account.usage?.oneWeek?.usedPercent} t={t} />
        </div>
      ) : (
        <>
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
            <button className="account-action-button" type="button" onClick={onSwitch} disabled={account.isCurrent}>
              <span className="account-action-icon switch-icon" aria-hidden="true" />
              <span>{t("accounts.action.switch")}</span>
            </button>
            <button className="account-action-button" type="button" onClick={onRefresh}>
              <span className="account-action-icon refresh-icon" aria-hidden="true" />
              <span>{t("common.refresh")}</span>
            </button>
            <button className="account-action-button danger" type="button" onClick={onDelete}>
              <span className="account-action-icon trash-icon" aria-hidden="true" />
              <span>{t("accounts.action.delete")}</span>
            </button>
          </div>
        </>
      )}
      {canShowCollapsedSwitchOverlay && (
        <div className="collapsed-switch-overlay" aria-hidden={!isCollapsedSwitchOverlayVisible}>
          <button
            className="account-action-button collapsed-switch-button"
            tabIndex={isCollapsedSwitchOverlayVisible ? 0 : -1}
            type="button"
            onClick={onSwitch}
          >
            <span className="account-action-icon switch-icon" aria-hidden="true" />
            <span>{t("accounts.action.switch")}</span>
          </button>
        </div>
      )}
    </article>
  );
}

function accountCardClassName(
  isCurrent: boolean,
  isCollapsed: boolean,
  viewMode: AccountViewMode,
  isCollapsedSwitchOverlayVisible = false
): string {
  return [
    "account-row",
    viewMode,
    isCurrent ? "current" : "",
    isCollapsed ? "collapsed" : "",
    isCollapsedSwitchOverlayVisible ? "switch-overlay-visible" : ""
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

function shortAccountName(account: AccountSummary): string {
  const displayValue = fullAccountName(account);
  const atIndex = displayValue.indexOf("@");
  if (atIndex > 0) {
    return displayValue.slice(0, atIndex);
  }
  return displayValue;
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
  compact = false,
  title,
  tone,
  usedPercent,
  t
}: {
  compact?: boolean;
  title: string;
  tone: "success" | "info";
  usedPercent?: number;
  t: Translator;
}): ReactElement {
  const hasUsage = usedPercent !== undefined && Number.isFinite(usedPercent);
  const used = hasUsage ? clampPercent(usedPercent) : 0;
  const remaining = hasUsage ? Math.max(0, 100 - used) : 0;
  const remainingText = hasUsage ? `${Math.round(remaining)}%` : "--";
  const usedText = hasUsage ? t("accounts.usage.used_percent", { percent: `${Math.round(used)}%` }) : t("accounts.usage.no_data");
  return (
    <div className={`usage-cell quota-ring-card ${tone}${compact ? " compact" : ""}`}>
      <div className="quota-ring" style={quotaRingStyle(remaining)}>
        <div className="quota-ring-center">
          {compact ? (
            <>
              <strong>{remainingText}</strong>
              <span>{compactWindowTitle(title)}</span>
            </>
          ) : (
            <>
              <span>{compactWindowTitle(title)}</span>
              <strong>{remainingText}</strong>
            </>
          )}
        </div>
      </div>
      {!compact && <small>{usedText}</small>}
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
  onCopy: (text: string, success?: string) => void;
  onRegenerateApiKey: () => void;
  onStart: (port: number, apiKey: string) => void;
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

  return (
    <div className="proxy-layout">
      <h2 className="page-title">{props.t("tab.proxy")}</h2>

      <section className="proxy-section">
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
                onClick={() => props.onStart(Number(port), apiKey)}
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
