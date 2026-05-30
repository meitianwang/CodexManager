import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { appInfo as fallbackAppInfo, type AppInfo } from "@shared/app-info";
import "./styles/app.css";

type PageID = "accounts" | "proxy" | "settings";

const pages: Array<{ id: PageID; label: string }> = [
  { id: "accounts", label: "Accounts" },
  { id: "proxy", label: "Proxy" },
  { id: "settings", label: "Settings" }
];

function App(): ReactElement {
  const [activePage, setActivePage] = useState<PageID>("accounts");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    const api = window.codexManager;
    if (!api) {
      setAppInfo(fallbackAppInfo);
      return;
    }
    void api.getAppInfo().then(setAppInfo);
  }, []);

  const pageTitle = useMemo(
    () => pages.find((page) => page.id === activePage)?.label ?? "Accounts",
    [activePage]
  );

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <div className="brand-block">
          <div className="brand-mark">CM</div>
          <div>
            <h1>{appInfo?.displayName ?? "CodexManager"}</h1>
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
          <span className="status-dot" />
          <span>Local workspace</span>
        </div>
      </aside>

      <section className="workspace" aria-labelledby="page-title">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">CodexManager for Windows</p>
            <h2 id="page-title">{pageTitle}</h2>
          </div>
          <button className="primary-action" type="button" disabled>
            Add account
          </button>
        </header>

        {activePage === "accounts" && <AccountsSurface />}
        {activePage === "proxy" && <ProxySurface />}
        {activePage === "settings" && <SettingsSurface />}
      </section>
    </main>
  );
}

function AccountsSurface(): ReactElement {
  return (
    <div className="surface-grid">
      <section className="surface-main">
        <div className="empty-state">
          <span className="empty-kicker">No accounts</span>
          <h3>Accounts will appear here after OAuth or auth-file import.</h3>
        </div>
      </section>
      <aside className="inspector">
        <h3>Quota windows</h3>
        <dl>
          <div>
            <dt>5 hour</dt>
            <dd>Not connected</dd>
          </div>
          <div>
            <dt>Weekly</dt>
            <dd>Not connected</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}

function ProxySurface(): ReactElement {
  return (
    <div className="single-panel">
      <div className="setting-row">
        <span>Port</span>
        <strong>18317</strong>
      </div>
      <div className="setting-row">
        <span>Status</span>
        <strong>Stopped</strong>
      </div>
      <div className="setting-row">
        <span>Endpoint</span>
        <strong>http://localhost:18317/v1</strong>
      </div>
    </div>
  );
}

function SettingsSurface(): ReactElement {
  return (
    <div className="single-panel">
      <div className="setting-row">
        <span>Launch at startup</span>
        <strong>Off</strong>
      </div>
      <div className="setting-row">
        <span>Auto smart switch</span>
        <strong>Off</strong>
      </div>
      <div className="setting-row">
        <span>Language</span>
        <strong>System</strong>
      </div>
    </div>
  );
}

export default App;
