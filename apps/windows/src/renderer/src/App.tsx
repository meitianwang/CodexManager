import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { appInfo as fallbackAppInfo, type AppInfo } from "@shared/app-info";
import type { AccountSummary } from "@shared/models/accounts";
import type { InstalledEditorApp } from "@shared/models/app";
import {
  defaultAppSettings,
  generateProxyApiKey,
  resolveAppLocale,
  type AppLocaleID,
  type AppSettings,
  type AppSettingsPatch,
  type EditorAppID
} from "@shared/models/settings";
import { proxyAvailableModels, proxyEndpoints, type ProxyEndpointID, type ProxyRuntimeState } from "@shared/models/proxy";
import "./styles/app.css";

type PageID = "accounts" | "proxy" | "settings";
type NoticeTone = "success" | "error" | "info";

interface Notice {
  text: string;
  tone: NoticeTone;
}

const pages: Array<{ id: PageID; label: string }> = [
  { id: "accounts", label: "Accounts" },
  { id: "proxy", label: "Proxy" },
  { id: "settings", label: "Settings" }
];

const localeOptions: Array<{ id: AppLocaleID; label: string }> = [
  { id: "en", label: "English" },
  { id: "zh-Hans", label: "简体中文" },
  { id: "zh-Hant", label: "繁體中文" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
  { id: "it", label: "Italiano" },
  { id: "es", label: "Español" },
  { id: "ru", label: "Русский" },
  { id: "nl", label: "Nederlands" }
];

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

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>, options: { silentSuccess?: boolean; success?: string } = {}) => {
      setBusyAction(label);
      setNotice(undefined);
      try {
        await action();
        if (!options.silentSuccess) {
          setNotice({ tone: "success", text: options.success ?? `${label} complete` });
        }
      } catch (error) {
        setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      } finally {
        setBusyAction(undefined);
      }
    },
    []
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
    void runAction("Loading", loadData, { silentSuccess: true });
  }, [loadData, runAction]);

  const reloadAccounts = useCallback(async () => {
    if (!api) {
      return;
    }
    setAccounts(await api.accounts.list());
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

  const currentPageLabel = useMemo(
    () => pages.find((page) => page.id === activePage)?.label ?? "Accounts",
    [activePage]
  );

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand-block">
          <div className="brand-mark">CM</div>
          <div>
            <h1>{appInfo.displayName}</h1>
            <p>Windows</p>
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
          <span>{proxyState.isRunning ? `Proxy ${proxyState.port}` : "Proxy stopped"}</span>
        </div>
      </aside>

      <section className="workspace" aria-labelledby="page-title">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">CodexManager for Windows</p>
            <h2 id="page-title">{currentPageLabel}</h2>
          </div>
          {notice && <div className={`notice ${notice.tone}`}>{notice.text}</div>}
        </header>

        {activePage === "accounts" && (
          <AccountsPage
            accounts={accounts}
            busyAction={busyAction}
            onAddViaLogin={() =>
              runAction("ChatGPT sign-in", async () => {
                if (!api) {
                  throw new Error("IPC bridge is unavailable");
                }
                await api.accounts.addViaLogin();
                await reloadAccounts();
              })
            }
            onDeleteSelected={() =>
              runAction("Delete selected accounts", async () => {
                if (!api) {
                  throw new Error("IPC bridge is unavailable");
                }
                for (const id of selectedAccountIds) {
                  await api.accounts.delete(id);
                }
                setSelectedAccountIds(new Set());
                await reloadAccounts();
              })
            }
            onExportSelected={() =>
              runAction("Export accounts", async () => {
                if (!api) {
                  throw new Error("IPC bridge is unavailable");
                }
                const result = await api.accounts.exportPackage([...selectedAccountIds]);
                if (result.canceled) {
                  setNotice({ tone: "info", text: "Export canceled" });
                }
              })
            }
            onImportAuthFile={() =>
              runAction("Import auth file", async () => {
                if (!api) {
                  throw new Error("IPC bridge is unavailable");
                }
                await api.accounts.importAuthFile();
                await reloadAccounts();
              })
            }
            onImportCurrent={() =>
              runAction("Import current auth", async () => {
                if (!api) {
                  throw new Error("IPC bridge is unavailable");
                }
                await api.accounts.importCurrentAuth();
                await reloadAccounts();
              })
            }
            onImportPackage={() =>
              runAction("Import package", async () => {
                if (!api) {
                  throw new Error("IPC bridge is unavailable");
                }
                await api.accounts.importPackage();
                await reloadAccounts();
              })
            }
            onRefreshAll={() =>
              runAction("Refresh usage", async () => {
                if (!api) {
                  throw new Error("IPC bridge is unavailable");
                }
                setAccounts(await api.accounts.refreshAllUsage());
              })
            }
            onRefreshUsage={(id) =>
              runAction("Refresh account", async () => {
                if (!api) {
                  throw new Error("IPC bridge is unavailable");
                }
                const refreshed = await api.accounts.refreshUsage(id);
                setAccounts((current) => current.map((account) => (account.id === id ? refreshed : account)));
              })
            }
            onSmartSwitch={() =>
              runAction("Smart switch", async () => {
                if (!api) {
                  throw new Error("IPC bridge is unavailable");
                }
                await api.accounts.smartSwitch();
                await reloadAccounts();
              })
            }
            onSwitchAccount={(id) =>
              runAction("Switch account", async () => {
                if (!api) {
                  throw new Error("IPC bridge is unavailable");
                }
                await api.accounts.switch(id);
                await reloadAccounts();
              })
            }
            onToggleSelection={(id) => setSelectedAccountIds((current) => toggleSetValue(current, id))}
            onUpdateAlias={(id, alias) =>
              runAction("Update alias", async () => {
                if (!api) {
                  throw new Error("IPC bridge is unavailable");
                }
                const updated = await api.accounts.updateTeamAlias(id, alias);
                setAccounts((current) => current.map((account) => (account.id === id ? updated : account)));
              })
            }
            selectedAccountIds={selectedAccountIds}
          />
        )}

        {activePage === "proxy" && (
          <ProxyPage
            busyAction={busyAction}
            onCopy={(text) =>
              runAction("Copy", async () => {
                if (!api) {
                  await navigator.clipboard.writeText(text);
                  return;
                }
                await api.clipboard.writeText(text);
              })
            }
            onRegenerateApiKey={() =>
              runAction("Regenerate API key", async () => {
                if (!api) {
                  const apiKey = generateProxyApiKey();
                  setProxyState((current) => ({ ...current, apiKey }));
                  return;
                }
                setProxyState(await api.proxy.regenerateApiKey());
              })
            }
            onStart={(port, apiKey) =>
              runAction("Start proxy", async () => {
                if (!api) {
                  setProxyState((current) => ({ ...current, apiKey, isRunning: true, port, proxyURL: `http://localhost:${port}` }));
                  return;
                }
                setProxyState(await api.proxy.start(port, apiKey));
              })
            }
            onStop={() =>
              runAction("Stop proxy", async () => {
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
          />
        )}

        {activePage === "settings" && (
          <SettingsPage
            installedEditors={installedEditors}
            onUpdateSettings={(patch) => runAction("Update settings", () => updateSettings(patch), { silentSuccess: true })}
            settings={settings}
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
  selectedAccountIds: ReadonlySet<string>;
}

function AccountsPage(props: AccountsPageProps): ReactElement {
  const hasSelection = props.selectedAccountIds.size > 0;
  return (
    <div className="page-grid accounts-grid">
      <section className="content-region">
        <div className="toolbar">
          <button type="button" onClick={props.onAddViaLogin} disabled={Boolean(props.busyAction)}>
            Sign in
          </button>
          <button type="button" onClick={props.onImportCurrent} disabled={Boolean(props.busyAction)}>
            Import current
          </button>
          <button type="button" onClick={props.onImportAuthFile} disabled={Boolean(props.busyAction)}>
            Import file
          </button>
          <button type="button" onClick={props.onImportPackage} disabled={Boolean(props.busyAction)}>
            Import package
          </button>
          <button type="button" onClick={props.onRefreshAll} disabled={Boolean(props.busyAction) || props.accounts.length === 0}>
            Refresh usage
          </button>
          <button type="button" onClick={props.onSmartSwitch} disabled={Boolean(props.busyAction) || props.accounts.length === 0}>
            Smart switch
          </button>
          <button type="button" onClick={props.onExportSelected} disabled={Boolean(props.busyAction) || !hasSelection}>
            Export
          </button>
          <button className="danger" type="button" onClick={props.onDeleteSelected} disabled={Boolean(props.busyAction) || !hasSelection}>
            Delete
          </button>
        </div>

        {props.accounts.length === 0 ? (
          <div className="empty-state">
            <span>No accounts</span>
            <h3>Add ChatGPT OAuth or import an existing Codex auth file.</h3>
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
              />
            ))}
          </div>
        )}
      </section>

      <aside className="inspector">
        <h3>Account status</h3>
        <MetricRow label="Accounts" value={String(props.accounts.length)} />
        <MetricRow label="Selected" value={String(props.selectedAccountIds.size)} />
        <MetricRow label="Current" value={props.accounts.find((account) => account.isCurrent)?.label ?? "None"} />
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
}

function AccountRow({ account, isSelected, onRefresh, onSwitch, onToggleSelection, onUpdateAlias }: AccountRowProps): ReactElement {
  const [alias, setAlias] = useState(account.teamName ?? "");
  useEffect(() => {
    setAlias(account.teamName ?? "");
  }, [account.teamName]);

  return (
    <article className={account.isCurrent ? "account-row current" : "account-row"}>
      <input aria-label={`Select ${account.label}`} checked={isSelected} type="checkbox" onChange={onToggleSelection} />
      <div className="account-main">
        <div className="account-title-line">
          <h3>{account.label}</h3>
          {account.isCurrent && <span className="badge">Current</span>}
          {account.shouldDisplayWorkspaceTag && <span className="badge muted">Workspace</span>}
        </div>
        <p>{account.email ?? account.accountId}</p>
        <div className="alias-line">
          <input
            aria-label={`Team alias for ${account.label}`}
            placeholder="Team alias"
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            onBlur={() => onUpdateAlias(alias)}
          />
        </div>
      </div>
      <UsageCell title="5 hour" usedPercent={account.usage?.fiveHour?.usedPercent} />
      <UsageCell title="Weekly" usedPercent={account.usage?.oneWeek?.usedPercent} />
      <div className="account-actions">
        <span className="plan-label">{account.normalizedPlanLabel}</span>
        <button type="button" onClick={onRefresh}>
          Refresh
        </button>
        <button type="button" onClick={onSwitch} disabled={account.isCurrent}>
          Switch
        </button>
      </div>
    </article>
  );
}

function UsageCell({ title, usedPercent }: { title: string; usedPercent?: number }): ReactElement {
  const percent = clampPercent(usedPercent);
  return (
    <div className="usage-cell">
      <div>
        <span>{title}</span>
        <strong>{usedPercent === undefined ? "No data" : `${Math.round(percent)}% used`}</strong>
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
            {props.proxyState.isRunning ? "Running" : "Stopped"}
          </div>
          <label>
            <span>Port</span>
            <input disabled={props.proxyState.isRunning} inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} />
          </label>
          <label className="api-key-field">
            <span>API key</span>
            <input disabled={props.proxyState.isRunning} value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
          </label>
          <button type="button" disabled={props.proxyState.isRunning || isBusy} onClick={props.onRegenerateApiKey}>
            Regenerate
          </button>
          {props.proxyState.isRunning ? (
            <button className="danger" type="button" disabled={isBusy} onClick={props.onStop}>
              Stop
            </button>
          ) : (
            <button
              className="primary-action"
              type="button"
              disabled={isBusy}
              onClick={() => props.onStart(Number(port), apiKey)}
            >
              Start
            </button>
          )}
        </div>

        <div className="split-region">
          <section>
            <h3>Endpoints</h3>
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
                  <em>{item.description}</em>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>Models</h3>
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

        <CodeBlock label="curl" text={curlText} onCopy={() => props.onCopy(curlText)} />
        <CodeBlock label="environment" text={configText} onCopy={() => props.onCopy(configText)} />
      </section>

      <aside className="inspector">
        <h3>Proxy details</h3>
        <MetricRow label="Base URL" value={props.proxyState.proxyURL} />
        <MetricRow label="API key" value={apiKey ? maskSecret(apiKey) : "Missing"} />
        <MetricRow label="Selected model" value={props.selectedModel} />
      </aside>
    </div>
  );
}

function CodeBlock({ label, text, onCopy }: { label: string; text: string; onCopy: () => void }): ReactElement {
  return (
    <section className="code-block">
      <div>
        <span>{label}</span>
        <button type="button" onClick={onCopy}>
          Copy
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
}

function SettingsPage({ installedEditors, onUpdateSettings, settings }: SettingsPageProps): ReactElement {
  return (
    <div className="settings-layout">
      <section className="settings-section">
        <h3>General</h3>
        <ToggleRow
          checked={settings.launchAtStartup}
          label="Launch at startup"
          onChange={(value) => onUpdateSettings({ launchAtStartup: value })}
        />
        <ToggleRow
          checked={settings.autoStartProxy}
          label="Start proxy automatically"
          onChange={(value) => onUpdateSettings({ autoStartProxy: value })}
        />
      </section>

      <section className="settings-section">
        <h3>Switch behavior</h3>
        <ToggleRow
          checked={settings.launchCodexAfterSwitch}
          label="Launch Codex after switching"
          onChange={(value) => onUpdateSettings({ launchCodexAfterSwitch: value })}
        />
        <ToggleRow
          checked={settings.autoSmartSwitch}
          label="Auto smart switch"
          onChange={(value) => onUpdateSettings({ autoSmartSwitch: value })}
        />
        <ToggleRow
          checked={settings.restartEditorsOnSwitch}
          label="Restart editors after switching"
          onChange={(value) => onUpdateSettings({ restartEditorsOnSwitch: value })}
        />
        <div className="editor-targets" aria-disabled={!settings.restartEditorsOnSwitch}>
          {installedEditors.length === 0 ? (
            <p>No supported editors detected.</p>
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
        <h3>Language</h3>
        <label className="select-row">
          <span>Application language</span>
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

export default App;
