import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { appInfo as fallbackAppInfo, type AppInfo } from "@shared/app-info";
import type { AccountSummary, WeeklyQuotaWarmupResult } from "@shared/models/accounts";
import type { InstalledEditorApp } from "@shared/models/app";
import {
  appLocales,
  defaultAppSettings,
  generateProxyApiKey,
  resolveAppLocale,
  type AppSettings,
  type AppSettingsPatch,
  type EditorAppID
} from "@shared/models/settings";
import { proxyAvailableModels, proxyEndpoints, type ProxyEndpointID, type ProxyRuntimeState } from "@shared/models/proxy";
import { createTranslator, languageNameKey, type Translator } from "./i18n";
import "./styles/app.css";

type PageID = "accounts" | "proxy" | "settings";
type NoticeTone = "success" | "error" | "info";

interface Notice {
  text: string;
  tone: NoticeTone;
}

function App(): ReactElement {
  const api = window.codexManager;
  const [activePage, setActivePage] = useState<PageID>("accounts");
  const [appInfo, setAppInfo] = useState<AppInfo>(fallbackAppInfo);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
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

  const reloadAccounts = useCallback(async () => {
    if (!api) {
      return;
    }
    setAccounts(await api.accounts.list());
  }, [api]);

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
          <div className="brand-mark">CM</div>
          <div>
            <h1>{appInfo.displayName}</h1>
            <p>{t("app.platform")}</p>
          </div>
        </div>

        <nav className="nav-list">
          {pages.map((page) => (
            <button
              key={page.id}
              className={page.id === activePage ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => setActivePage(page.id)}
            >
              <span>{page.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className={proxyState.isRunning ? "status-dot running" : "status-dot"} />
          <span>{proxyState.isRunning ? t("sidebar.proxy_running", { port: proxyState.port }) : t("sidebar.proxy_stopped")}</span>
        </div>
      </aside>

      <section className="workspace" aria-labelledby="page-title">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">{t("app.eyebrow")}</p>
            <h2 id="page-title">{currentPageLabel}</h2>
          </div>
          {notice && <div className={`notice ${notice.tone}`}>{notice.text}</div>}
        </header>

        {activePage === "accounts" && (
          <AccountsPage
            accounts={accounts}
            busyAction={busyAction}
            onAddViaLogin={() =>
              runAction(t("accounts.action.sign_in"), async () => {
                if (!api) {
                  throw new Error(t("error.ipc_bridge_unavailable"));
                }
                await api.accounts.addViaLogin();
                await reloadAccounts();
              })
            }
            onDeleteSelected={() =>
              runAction(t("accounts.action.delete"), async () => {
                if (!api) {
                  throw new Error(t("error.ipc_bridge_unavailable"));
                }
                for (const id of selectedAccountIds) {
                  await api.accounts.delete(id);
                }
                setSelectedAccountIds(new Set());
                await reloadAccounts();
              })
            }
            onExportSelected={() =>
              runAction(t("accounts.action.export"), async () => {
                if (!api) {
                  throw new Error(t("error.ipc_bridge_unavailable"));
                }
                const result = await api.accounts.exportPackage([...selectedAccountIds]);
                if (result.canceled) {
                  setNotice({ tone: "info", text: t("notice.export_canceled") });
                }
              })
            }
            onImportAuthFile={() =>
              runAction(t("accounts.action.import_file"), async () => {
                if (!api) {
                  throw new Error(t("error.ipc_bridge_unavailable"));
                }
                await api.accounts.importAuthFile();
                await reloadAccounts();
              })
            }
            onImportCurrent={() =>
              runAction(t("accounts.action.import_current"), async () => {
                if (!api) {
                  throw new Error(t("error.ipc_bridge_unavailable"));
                }
                await api.accounts.importCurrentAuth();
                await reloadAccounts();
              })
            }
            onImportPackage={() =>
              runAction(t("accounts.action.import_package"), async () => {
                if (!api) {
                  throw new Error(t("error.ipc_bridge_unavailable"));
                }
                await api.accounts.importPackage();
                await reloadAccounts();
              })
            }
            onRefreshAll={() =>
              runAction(t("accounts.action.refresh_usage"), async () => {
                if (!api) {
                  throw new Error(t("error.ipc_bridge_unavailable"));
                }
                setAccounts(await api.accounts.refreshAllUsage());
              })
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
              runAction(t("common.refresh"), async () => {
                if (!api) {
                  throw new Error(t("error.ipc_bridge_unavailable"));
                }
                const refreshed = await api.accounts.refreshUsage(id);
                setAccounts((current) => current.map((account) => (account.id === id ? refreshed : account)));
              })
            }
            onSmartSwitch={() =>
              runAction(t("accounts.action.smart_switch"), async () => {
                if (!api) {
                  throw new Error(t("error.ipc_bridge_unavailable"));
                }
                await api.accounts.smartSwitch();
                await reloadAccounts();
              })
            }
            onSwitchAccount={(id) =>
              runAction(t("accounts.action.switch"), async () => {
                if (!api) {
                  throw new Error(t("error.ipc_bridge_unavailable"));
                }
                await api.accounts.switch(id);
                await reloadAccounts();
              })
            }
            onToggleSelection={(id) => setSelectedAccountIds((current) => toggleSetValue(current, id))}
            onUpdateAlias={(id, alias) =>
              runAction(t("accounts.card.team_alias"), async () => {
                if (!api) {
                  throw new Error(t("error.ipc_bridge_unavailable"));
                }
                const updated = await api.accounts.updateTeamAlias(id, alias);
                setAccounts((current) => current.map((account) => (account.id === id ? updated : account)));
              })
            }
            selectedAccountIds={selectedAccountIds}
            t={t}
          />
        )}

        {activePage === "proxy" && (
          <ProxyPage
            busyAction={busyAction}
            onCopy={(text) =>
              runAction(t("action.copy"), async () => {
                if (!api) {
                  await navigator.clipboard.writeText(text);
                  return;
                }
                await api.clipboard.writeText(text);
              })
            }
            onRegenerateApiKey={() =>
              runAction(t("proxy.api_key.regenerate"), async () => {
                if (!api) {
                  const apiKey = generateProxyApiKey();
                  setProxyState((current) => ({ ...current, apiKey }));
                  return;
                }
                setProxyState(await api.proxy.regenerateApiKey());
              })
            }
            onStart={(port, apiKey) =>
              runAction(t("common.start"), async () => {
                if (!api) {
                  setProxyState((current) => ({ ...current, apiKey, isRunning: true, port, proxyURL: `http://localhost:${port}` }));
                  return;
                }
                setProxyState(await api.proxy.start(port, apiKey));
              })
            }
            onStop={() =>
              runAction(t("common.stop"), async () => {
                if (!api) {
                  setProxyState((current) => ({ ...current, isRunning: false }));
                  return;
                }
                setProxyState(await api.proxy.stop());
              })
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
            onUpdateSettings={(patch) => runAction(t("tab.settings"), () => updateSettings(patch), { silentSuccess: true })}
            settings={settings}
            t={t}
          />
        )}
      </section>
    </main>
  );
}

interface AccountsPageProps {
  accounts: AccountSummary[];
  busyAction?: string;
  onAddViaLogin: () => void;
  onDeleteSelected: () => void;
  onExportSelected: () => void;
  onImportAuthFile: () => void;
  onImportCurrent: () => void;
  onImportPackage: () => void;
  onRefreshAll: () => void;
  onRefreshUsage: (id: string) => void;
  onSmartSwitch: () => void;
  onSwitchAccount: (id: string) => void;
  onToggleSelection: (id: string) => void;
  onUpdateAlias: (id: string, alias?: string) => void;
  onWarmUpWeeklyQuota: () => void;
  selectedAccountIds: ReadonlySet<string>;
  t: Translator;
}

function AccountsPage(props: AccountsPageProps): ReactElement {
  const hasSelection = props.selectedAccountIds.size > 0;
  return (
    <div className="page-grid accounts-grid">
      <section className="content-region">
        <div className="toolbar">
          <button type="button" onClick={props.onAddViaLogin} disabled={Boolean(props.busyAction)}>
            {props.t("accounts.action.sign_in")}
          </button>
          <button type="button" onClick={props.onImportCurrent} disabled={Boolean(props.busyAction)}>
            {props.t("accounts.action.import_current")}
          </button>
          <button type="button" onClick={props.onImportAuthFile} disabled={Boolean(props.busyAction)}>
            {props.t("accounts.action.import_file")}
          </button>
          <button type="button" onClick={props.onImportPackage} disabled={Boolean(props.busyAction)}>
            {props.t("accounts.action.import_package")}
          </button>
          <button type="button" onClick={props.onRefreshAll} disabled={Boolean(props.busyAction) || props.accounts.length === 0}>
            {props.t("accounts.action.refresh_usage")}
          </button>
          <button type="button" onClick={props.onWarmUpWeeklyQuota} disabled={Boolean(props.busyAction) || props.accounts.length === 0}>
            {props.t("accounts.action.warm_weekly_quota")}
          </button>
          <button type="button" onClick={props.onSmartSwitch} disabled={Boolean(props.busyAction) || props.accounts.length === 0}>
            {props.t("accounts.action.smart_switch")}
          </button>
          <button type="button" onClick={props.onExportSelected} disabled={Boolean(props.busyAction) || !hasSelection}>
            {props.t("accounts.action.export")}
          </button>
          <button className="danger" type="button" onClick={props.onDeleteSelected} disabled={Boolean(props.busyAction) || !hasSelection}>
            {props.t("accounts.action.delete")}
          </button>
        </div>

        {props.accounts.length === 0 ? (
          <div className="empty-state">
            <span>{props.t("accounts.empty.title")}</span>
            <h3>{props.t("accounts.empty.message")}</h3>
          </div>
        ) : (
          <div className="account-list">
            {props.accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                isSelected={props.selectedAccountIds.has(account.id)}
                onRefresh={() => props.onRefreshUsage(account.id)}
                onSwitch={() => props.onSwitchAccount(account.id)}
                onToggleSelection={() => props.onToggleSelection(account.id)}
                onUpdateAlias={(alias) => props.onUpdateAlias(account.id, alias)}
                t={props.t}
              />
            ))}
          </div>
        )}
      </section>

      <aside className="inspector">
        <h3>{props.t("accounts.status.title")}</h3>
        <MetricRow label={props.t("accounts.status.accounts")} value={String(props.accounts.length)} />
        <MetricRow label={props.t("accounts.status.selected")} value={String(props.selectedAccountIds.size)} />
        <MetricRow label={props.t("accounts.status.current")} value={props.accounts.find((account) => account.isCurrent)?.label ?? props.t("common.none")} />
      </aside>
    </div>
  );
}

interface AccountRowProps {
  account: AccountSummary;
  isSelected: boolean;
  onRefresh: () => void;
  onSwitch: () => void;
  onToggleSelection: () => void;
  onUpdateAlias: (alias?: string) => void;
  t: Translator;
}

function AccountRow({ account, isSelected, onRefresh, onSwitch, onToggleSelection, onUpdateAlias, t }: AccountRowProps): ReactElement {
  const [alias, setAlias] = useState(account.teamAlias ?? "");
  useEffect(() => {
    setAlias(account.teamAlias ?? "");
  }, [account.teamAlias]);

  return (
    <article className={account.isCurrent ? "account-row current" : "account-row"}>
      <input aria-label={`${t("accounts.status.selected")} ${account.label}`} checked={isSelected} type="checkbox" onChange={onToggleSelection} />
      <div className="account-main">
        <div className="account-title-line">
          <h3>{account.label}</h3>
          {account.isCurrent && <span className="badge">{t("accounts.card.current")}</span>}
          {account.shouldDisplayWorkspaceTag && <span className="badge muted">{account.displayTeamName}</span>}
        </div>
        <p>{account.email ?? account.accountId}</p>
        <div className="alias-line">
          <input
            aria-label={`${t("accounts.card.team_alias")} ${account.label}`}
            placeholder={t("accounts.card.team_alias")}
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            onBlur={() => onUpdateAlias(alias)}
          />
        </div>
      </div>
      <UsageCell title={t("accounts.window.five_hour")} usedPercent={account.usage?.fiveHour?.usedPercent} t={t} />
      <UsageCell title={t("accounts.window.weekly")} usedPercent={account.usage?.oneWeek?.usedPercent} t={t} />
      <div className="account-actions">
        <span className="plan-label">{account.normalizedPlanLabel}</span>
        <button type="button" onClick={onRefresh}>
          {t("common.refresh")}
        </button>
        <button type="button" onClick={onSwitch} disabled={account.isCurrent}>
          {t("accounts.action.switch")}
        </button>
      </div>
    </article>
  );
}

function UsageCell({ title, usedPercent, t }: { title: string; usedPercent?: number; t: Translator }): ReactElement {
  const percent = clampPercent(usedPercent);
  return (
    <div className="usage-cell">
      <div>
        <span>{title}</span>
        <strong>{usedPercent === undefined ? t("accounts.usage.no_data") : t("accounts.usage.used_percent", { percent: Math.round(percent) })}</strong>
      </div>
      <div className="usage-track">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

interface ProxyPageProps {
  busyAction?: string;
  onCopy: (text: string) => void;
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
  const curlText = proxyCurlExample(props.proxyState.proxyURL, endpoint.id, props.selectedModel, apiKey);
  const configText = proxyConfigText(props.proxyState.proxyURL, endpoint.id, apiKey);
  const isBusy = Boolean(props.busyAction);

  return (
    <div className="page-grid proxy-grid">
      <section className="content-region">
        <div className="proxy-control">
          <div className={props.proxyState.isRunning ? "status-pill running" : "status-pill"}>
            <span />
            {props.proxyState.isRunning ? props.t("proxy.status.running") : props.t("proxy.status.stopped")}
          </div>
          <label>
            <span>{props.t("proxy.port")}</span>
            <input disabled={props.proxyState.isRunning} inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} />
          </label>
          <label className="api-key-field">
            <span>{props.t("proxy.api_key")}</span>
            <input disabled={props.proxyState.isRunning} value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
          </label>
          <button type="button" disabled={props.proxyState.isRunning || isBusy} onClick={props.onRegenerateApiKey}>
            {props.t("proxy.api_key.regenerate")}
          </button>
          {props.proxyState.isRunning ? (
            <button className="danger" type="button" disabled={isBusy} onClick={props.onStop}>
              {props.t("common.stop")}
            </button>
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

        <div className="split-region">
          <section>
            <h3>{props.t("proxy.section.endpoints")}</h3>
            <div className="endpoint-list">
              {proxyEndpoints.map((item) => (
                <button
                  key={item.id}
                  className={item.id === props.selectedEndpoint ? "endpoint-row selected" : "endpoint-row"}
                  type="button"
                  onClick={() => props.setSelectedEndpoint(item.id)}
                >
                  <span>{item.method}</span>
                  <code>{item.path}</code>
                  <em>{proxyEndpointDescription(item.id, props.t)}</em>
                </button>
              ))}
            </div>
          </section>

          <section>
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

        <CodeBlock label={props.t("proxy.code.curl")} text={curlText} onCopy={() => props.onCopy(curlText)} t={props.t} />
        <CodeBlock label={props.t("proxy.code.environment")} text={configText} onCopy={() => props.onCopy(configText)} t={props.t} />
      </section>

      <aside className="inspector">
        <h3>{props.t("proxy.details.title")}</h3>
        <MetricRow label={props.t("proxy.details.base_url")} value={props.proxyState.proxyURL} />
        <MetricRow label={props.t("proxy.api_key")} value={apiKey ? maskSecret(apiKey) : props.t("common.missing")} />
        <MetricRow label={props.t("proxy.details.selected_model")} value={props.selectedModel} />
      </aside>
    </div>
  );
}

function CodeBlock({ label, text, onCopy, t }: { label: string; text: string; onCopy: () => void; t: Translator }): ReactElement {
  return (
    <section className="code-block">
      <div>
        <span>{label}</span>
        <button type="button" onClick={onCopy}>
          {t("common.copy")}
        </button>
      </div>
      <pre>{text}</pre>
    </section>
  );
}

interface SettingsPageProps {
  installedEditors: InstalledEditorApp[];
  onUpdateSettings: (patch: AppSettingsPatch) => void;
  settings: AppSettings;
  t: Translator;
}

function SettingsPage({ installedEditors, onUpdateSettings, settings, t }: SettingsPageProps): ReactElement {
  const localeOptions = appLocales.map((locale) => ({ id: locale, label: t(languageNameKey(locale)) }));
  return (
    <div className="settings-layout">
      <section className="settings-section">
        <h3>{t("settings.section.general")}</h3>
        <ToggleRow
          checked={settings.launchAtStartup}
          label={t("settings.launch_at_startup")}
          onChange={(value) => onUpdateSettings({ launchAtStartup: value })}
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
          checked={settings.launchCodexAfterSwitch}
          label={t("settings.launch_codex_after_switch")}
          onChange={(value) => onUpdateSettings({ launchCodexAfterSwitch: value })}
        />
        <ToggleRow
          checked={settings.autoSmartSwitch}
          label={t("settings.auto_smart_switch")}
          onChange={(value) => onUpdateSettings({ autoSmartSwitch: value })}
        />
        <ToggleRow
          checked={settings.restartEditorsOnSwitch}
          label={t("settings.restart_editors_on_switch")}
          onChange={(value) => onUpdateSettings({ restartEditorsOnSwitch: value })}
        />
        <div className="editor-targets" aria-disabled={!settings.restartEditorsOnSwitch}>
          {installedEditors.length === 0 ? (
            <p>{t("settings.no_supported_editors")}</p>
          ) : (
            installedEditors.map((editor) => (
              <label key={editor.id}>
                <input
                  checked={settings.restartEditorTargets.includes(editor.id)}
                  disabled={!settings.restartEditorsOnSwitch}
                  type="checkbox"
                  onChange={() =>
                    onUpdateSettings({
                      restartEditorTargets: toggleArrayValue(settings.restartEditorTargets, editor.id)
                    })
                  }
                />
                <span>{editor.label}</span>
              </label>
            ))
          )}
        </div>
      </section>

      <section className="settings-section">
        <h3>{t("settings.section.language")}</h3>
        <label className="select-row">
          <span>{t("settings.application_language")}</span>
          <select value={settings.locale} onChange={(event) => onUpdateSettings({ locale: event.target.value })}>
            {localeOptions.map((locale) => (
              <option key={locale.id} value={locale.id}>
                {locale.label}
              </option>
            ))}
          </select>
        </label>
      </section>
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

function MetricRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

function toggleSetValue(values: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function toggleArrayValue(values: readonly EditorAppID[], value: EditorAppID): EditorAppID[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function clampPercent(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function maskSecret(value: string): string {
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-4)}`;
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

function weeklyWarmupNotice(result: WeeklyQuotaWarmupResult, t: Translator): string {
  if (result.targetCount === 0) {
    return t("accounts.notice.weekly_no_targets");
  }
  if (result.failures.length === 0) {
    return t("accounts.notice.weekly_complete", { succeeded: result.succeededCount });
  }
  return t("accounts.notice.weekly_partial", { succeeded: result.succeededCount, failed: result.failures.length });
}

export default App;
