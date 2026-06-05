import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appInfo as fallbackAppInfo } from "../src/shared/app-info";
import type { AccountsImportFileResult, AccountTransferSelectableItem } from "../src/shared/models/account-transfer";
import type { AccountSummary, WeeklyQuotaWarmupResult } from "../src/shared/models/accounts";
import type { InstalledEditorApp, SmartSwitchResult, SwitchAccountExecutionResult } from "../src/shared/models/app";
import { proxyAvailableModels, type ProxyRuntimeState } from "../src/shared/models/proxy";
import { defaultAppSettings, resolveAppLocale, type AppSettings } from "../src/shared/models/settings";
import type { CodexManagerAPI } from "../src/preload";
import App from "../src/renderer/src/App";

describe("desktop renderer app", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    window.codexManager = undefined;
    vi.restoreAllMocks();
  });

  it("renders the accounts workspace and navigates to proxy and settings without IPC", () => {
    const { container } = render(<App />);

    expect(container.querySelector(".app-shell")?.getAttribute("data-active-page")).toBe("accounts");
    expect(rendererStyles()).toContain("grid-template-columns: 163px minmax(0, 1fr);");
    expect(rendererStyles()).toContain("gap: 18px;");
    expect(rendererStyles()).toContain("padding: 18px 14px 14px;");
    expect(rendererStyles()).toContain("padding: 16px 22px 22px;");
    expect(rendererStyles()).toContain("margin-bottom: 14px;");
    expect(rendererStyles()).toContain("font-size: 20px;");
    expect(rendererStyles()).toContain("background: #fafafc;");
    expect(rendererStyles()).toContain("min-width: 900px;");
    expect(rendererStyles()).toContain("min-height: 520px;");
    expect(rendererStyles()).toContain("background: #f7f5fc;");
    expect(rendererStyles()).toContain("background: #5933d6;");
    expect(rendererStyles()).toContain("color: #121217;");
    expect(rendererStyles()).not.toContain("#12130f");
    expect(rendererStyles()).not.toContain("rgba(214, 240, 95");
    expect(container.querySelector(".brand-block .brand-mark .brand-mark-icon")).toBeTruthy();
    expect(container.querySelector(".brand-block h1")?.textContent).toBe("CodexManager");
    expect(container.querySelector(".brand-block p")).toBeNull();
    expect(container.querySelector(".workspace-header")).toBeNull();
    expect(container.querySelector(".accounts-action-bar")).toBeTruthy();
    expect(container.querySelector(".content-region")).toBeNull();
    expect(container.querySelector(".inspector")).toBeNull();
    expect(rendererStyles()).not.toContain(".page-grid");
    expect(rendererStyles()).not.toContain(".inspector");
    expect(screen.queryByText("CodexManager for Windows")).toBeNull();
    expect(container.querySelectorAll(".nav-list .nav-icon")).toHaveLength(3);
    expect(container.querySelector(".nav-list .accounts-nav-icon")).toBeTruthy();
    expect(container.querySelector(".nav-list .proxy-nav-icon")).toBeTruthy();
    expect(container.querySelector(".nav-list .settings-nav-icon")).toBeTruthy();
    expect(container.querySelector(".sidebar-footer .sidebar-divider")).toBeTruthy();
    expect(container.querySelector(".sidebar-footer .sidebar-status-row")?.textContent).toBe("Proxy: Stopped");
    expect(container.querySelector(".sidebar-footer .app-version")?.textContent).toBe(`v${fallbackAppInfo.version}`);
    expect(screen.getByRole("heading", { level: 2, name: "Accounts" })).toBeTruthy();
    expect(screen.getByText("No accounts yet. Add or import an account to get started.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Proxy" }));
    expect(container.querySelector(".app-shell")?.getAttribute("data-active-page")).toBe("proxy");
    expect(screen.getByRole("heading", { level: 2, name: "Proxy" })).toBeTruthy();
    expect(screen.getByText("/v1/chat/completions")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(container.querySelector(".app-shell")?.getAttribute("data-active-page")).toBe("settings");
    expect(screen.getByRole("heading", { level: 2, name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Launch at startup")).toBeTruthy();
  });

  it("shows the desktop accounts loading state while IPC data loads", async () => {
    const api = installMockAPI({ accounts: [makeAccount("a", "Work")] });
    const pendingAccounts = deferred<AccountSummary[]>();
    api.accounts.list = vi.fn(() => pendingAccounts.promise);

    render(<App />);

    expect(screen.getByRole("status").textContent).toContain("Loading accounts...");
    expect(screen.queryByText("No accounts yet. Add or import an account to get started.")).toBeNull();
    expect(rendererStyles()).toContain(".loading-icon");
    expect(rendererStyles()).toContain("@keyframes spin");

    await act(async () => {
      pendingAccounts.resolve([makeAccount("a", "Work")]);
      await pendingAccounts.promise;
    });

    expect(await screen.findByText("a@example.com")).toBeTruthy();
  });

  it("shows the desktop accounts load error state instead of the empty state", async () => {
    const api = installMockAPI();
    api.accounts.list = vi.fn(async () => {
      throw new Error("accounts.json missing");
    });

    render(<App />);

    expect(await screen.findByText("Failed to load accounts")).toBeTruthy();
    expect(document.querySelector(".empty-state.error-state")?.textContent).toContain("accounts.json missing");
    expect(screen.queryByText("No accounts yet. Add or import an account to get started.")).toBeNull();
    expect(document.querySelector(".empty-state.error-state .error-state-icon")).toBeTruthy();
  });

  it("drives account import, export, delete, refresh, and switch actions through mocked IPC", async () => {
    const account = makeAccount("a", "Work");
    const api = installMockAPI({ accounts: [account] });
    const { container } = render(<App />);

    expect(await screen.findByText("a@example.com")).toBeTruthy();
    expect(within(accountRow("a@example.com")).getByText("a@example.com")).toBeTruthy();
    expect(screen.queryByLabelText("Set team name Work")).toBeNull();
    expect(accountRow("a@example.com").querySelector(".alias-line")).toBeNull();
    expect(accountRow("a@example.com").querySelector(".account-card-header")?.textContent).toContain("PRO");
    expect(accountRow("a@example.com").querySelector(".account-card-header .badge.plan.pro-plan")?.textContent).toBe("PRO");
    expect(rendererStyles()).not.toContain("compact-plan");
    expect(rendererStyles()).not.toContain(".alias-line");
    expect(rendererStyles()).toContain("background: #e8e0ff;");
    expect(accountRow("a@example.com").querySelector(".account-card-header .ellipsis-icon")).toBeTruthy();
    expect(accountRow("a@example.com").querySelector(".account-title-line")?.textContent).toBe("a@example.com");
    expect(accountRow("a@example.com").querySelector(".account-identifier")).toBeNull();
    expect(accountRow("a@example.com").querySelector(".account-actions")?.textContent).toBe("SwitchRefreshDelete");
    expect(accountRow("a@example.com").querySelector(".account-actions .switch-icon")).toBeTruthy();
    expect(accountRow("a@example.com").querySelector(".account-actions .refresh-icon")).toBeTruthy();
    expect(accountRow("a@example.com").querySelector(".account-actions .trash-icon")).toBeTruthy();
    expect(within(accountRow("a@example.com")).getAllByText("5h").length).toBeGreaterThanOrEqual(1);
    expect(within(accountRow("a@example.com")).getAllByText("1 week").length).toBeGreaterThanOrEqual(1);
    const toolbar = container.querySelector(".toolbar") as HTMLElement;
    expect(Array.from(toolbar.querySelectorAll("button")).map((button) => button.textContent)).toEqual([
      "Export accounts",
      "Import file",
      "Import current auth",
      "Add account",
      "Smart switch",
      "Warm up weekly quota",
      ""
    ]);
    expect(toolbar.querySelectorAll(".toolbar-action-icon")).toHaveLength(7);
    expect(toolbar.querySelector(".export-accounts-icon")).toBeTruthy();
    expect(toolbar.querySelector(".import-package-icon")).toBeTruthy();
    expect(toolbar.querySelector(".import-current-icon")).toBeTruthy();
    expect(toolbar.querySelector(".add-account-icon")).toBeTruthy();
    expect(toolbar.querySelector(".smart-switch-action-icon")).toBeTruthy();
    expect(toolbar.querySelector(".warmup-action-icon")).toBeTruthy();
    expect(toolbar.querySelector(".toolbar-action-button.primary-action")?.textContent).toBe("Add account");
    const refreshUsageButton = within(toolbar).getByRole("button", { name: "Refresh usage" });
    expect(refreshUsageButton.textContent).toBe("");
    expect(refreshUsageButton.querySelector(".refresh-icon")).toBeTruthy();

    expect((screen.getByRole("button", { name: "Export accounts" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Export accounts" }));
    const exportDialog = await screen.findByRole("dialog", { name: "Choose accounts to export" });
    expect((within(exportDialog).getByLabelText("Selected Work") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(exportDialog).getByRole("button", { name: "Export" }));
    await waitFor(() => expect(api.accounts.exportPackage).toHaveBeenCalledWith(["a"]));
    expect(await screen.findByText("1 accounts exported")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    await waitFor(() => expect(api.accounts.addViaLogin).toHaveBeenCalledOnce());
    await waitFor(() => expect(api.accounts.list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("New account imported: OAuth")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Import current auth" }));
    await waitFor(() => expect(api.accounts.importCurrentAuth).toHaveBeenCalledOnce());
    expect(await screen.findByText("Account imported: Current auth")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Import file" }));
    await waitFor(() => expect(api.accounts.importFile).toHaveBeenCalledOnce());
    const importDialog = await screen.findByRole("dialog", { name: "Choose accounts to import" });
    expect((within(importDialog).getByLabelText("Selected Package") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(importDialog).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(api.accounts.importPreparedPackage).toHaveBeenCalledWith("draft-1", ["package"]));
    expect(await screen.findByText("Imported 1 accounts, updated 0")).toBeTruthy();

    fireEvent.click(within(toolbar).getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(api.accounts.refreshAllUsage).toHaveBeenCalledOnce());
    expect(await screen.findByText("Accounts refreshed")).toBeTruthy();
    expect(document.querySelector(".notice.info")?.textContent).toContain("Accounts refreshed");
    expect(within(accountRow("a@example.com")).getByText("88%")).toBeTruthy();
    expect(within(accountRow("a@example.com")).getByText("66%")).toBeTruthy();
    expect(within(accountRow("a@example.com")).getByText("Used 12%")).toBeTruthy();
    expect(within(accountRow("a@example.com")).getByText("Used 34%")).toBeTruthy();
    expect(accountRow("a@example.com").querySelectorAll(".quota-ring")).toHaveLength(2);
    expect(accountRow("a@example.com").querySelector(".usage-track")).toBeNull();
    expect(within(accountRow("a@example.com")).getByText("Reset")).toBeTruthy();
    expect(screen.queryByText("Usage refresh failed")).toBeNull();
    const resetRows = Array.from(accountRow("a@example.com").querySelectorAll(".reset-row")).map((row) => row.textContent ?? "");
    expect(resetRows).toHaveLength(2);
    expect(resetRows[0]).toContain("5h");
    expect(resetRows[0]).not.toContain("--");
    expect(resetRows[1]).toContain("1 week");
    expect(resetRows[1]).not.toContain("--");

    const accountRefreshButton = within(accountRow("a@example.com")).getByRole("button", { name: "Refresh usage" });
    expect(accountRefreshButton).toBeDefined();
    expect((accountRefreshButton as HTMLElement).textContent).toBe("Refresh");
    fireEvent.click(accountRefreshButton as HTMLElement);
    await waitFor(() => expect(api.accounts.refreshUsage).toHaveBeenCalledWith("a"));
    expect(screen.queryByText("Usage refreshed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Smart switch" }));
    await waitFor(() => expect(api.accounts.smartSwitch).toHaveBeenCalledOnce());

    const accountSwitchButton = within(accountRow("a@example.com")).getByRole("button", { name: "Switch to this" });
    expect(accountSwitchButton).toBeDefined();
    expect((accountSwitchButton as HTMLElement).textContent).toBe("Switch");
    fireEvent.click(accountSwitchButton as HTMLElement);
    await waitFor(() => expect(api.accounts.switch).toHaveBeenCalledWith("a"));

    const accountDeleteButton = within(accountRow("a@example.com")).getByRole("button", { name: "Delete" });
    expect(accountDeleteButton).toBeDefined();
    fireEvent.click(accountDeleteButton as HTMLElement);
    await waitFor(() => expect(api.accounts.delete).toHaveBeenCalledWith("a"));
    expect(await screen.findByText("Account deleted")).toBeTruthy();
    expect(document.querySelector(".notice.info")?.textContent).toContain("Account deleted");
  });

  it("uses the desktop missing usage window fallback in account cards", async () => {
    installMockAPI({ accounts: [makeAccount("a", "Work")] });

    render(<App />);

    expect(await screen.findByText("a@example.com")).toBeTruthy();
    expect(within(accountRow("a@example.com")).getAllByText("0%")).toHaveLength(2);
    expect(within(accountRow("a@example.com")).getAllByText("Used 100%")).toHaveLength(2);
    expect(screen.queryByText("No data")).toBeNull();
    expect(within(accountRow("a@example.com")).getAllByText("--")).toHaveLength(2);
  });

  it("shows direct account switch progress on the account card", async () => {
    const api = installMockAPI({ accounts: [makeAccount("a", "Work")] });
    const pendingSwitch = deferred<SwitchAccountExecutionResult>();
    api.accounts.switch = vi.fn(() => pendingSwitch.promise);

    render(<App />);

    expect(await screen.findByText("a@example.com")).toBeTruthy();
    const switchButton = within(accountRow("a@example.com")).getByRole("button", { name: "Switch to this" }) as HTMLButtonElement;
    fireEvent.click(switchButton);

    await waitFor(() => expect(api.accounts.switch).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(switchButton.disabled).toBe(true));
    expect(switchButton.textContent).toBe("");
    expect(switchButton.querySelector(".loading-icon")).toBeTruthy();

    await resolveDeferred(pendingSwitch, { restartedEditorApps: [], usedFallbackCLI: false });

    await waitFor(() => expect(switchButton.disabled).toBe(false));
    expect(switchButton.textContent).toBe("Switch");
  });

  it("shows desktop account toolbar busy labels and refresh spinner", async () => {
    const account = makeAccount("a", "Work");
    const api = installMockAPI({ accounts: [account] });
    const { container } = render(<App />);
    const toolbar = (): HTMLElement => container.querySelector(".toolbar") as HTMLElement;

    expect(await screen.findByText("a@example.com")).toBeTruthy();

    const pendingExport = deferred<{ canceled: boolean; path?: string }>();
    api.accounts.exportPackage = vi.fn(() => pendingExport.promise);
    fireEvent.click(screen.getByRole("button", { name: "Export accounts" }));
    const exportDialog = await screen.findByRole("dialog", { name: "Choose accounts to export" });
    fireEvent.click(within(exportDialog).getByRole("button", { name: "Export" }));
    expect(await screen.findByRole("button", { name: "Exporting..." })).toBeTruthy();
    await resolveDeferred(pendingExport, { canceled: false, path: String.raw`C:\exports\accounts.codexmanager.json` });
    await waitFor(() => expect(screen.getByRole("button", { name: "Export accounts" })).toBeTruthy());

    const pendingImportFile = deferred<AccountsImportFileResult | undefined>();
    api.accounts.importFile = vi.fn(() => pendingImportFile.promise);
    fireEvent.click(screen.getByRole("button", { name: "Import file" }));
    expect(await screen.findByRole("button", { name: "Importing..." })).toBeTruthy();
    await resolveDeferred(pendingImportFile, undefined);
    await waitFor(() => expect(screen.getByRole("button", { name: "Import file" })).toBeTruthy());

    const pendingImportCurrent = deferred<AccountSummary>();
    api.accounts.importCurrentAuth = vi.fn(() => pendingImportCurrent.promise);
    fireEvent.click(screen.getByRole("button", { name: "Import current auth" }));
    expect(await screen.findByRole("button", { name: "Importing..." })).toBeTruthy();
    await resolveDeferred(pendingImportCurrent, makeAccount("current", "Current auth"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Import current auth" })).toBeTruthy());

    const pendingAdd = deferred<AccountSummary>();
    api.accounts.addViaLogin = vi.fn(() => pendingAdd.promise);
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    const waitingForLoginButton = await screen.findByRole("button", { name: "Waiting for login..." });
    expect((waitingForLoginButton as HTMLButtonElement).disabled).toBe(true);
    await resolveDeferred(pendingAdd, makeAccount("login", "OAuth"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add account" })).toBeTruthy());

    const pendingWarmup = deferred<WeeklyQuotaWarmupResult>();
    api.accounts.warmUpWeeklyQuota = vi.fn(() => pendingWarmup.promise);
    fireEvent.click(screen.getByRole("button", { name: "Warm up weekly quota" }));
    expect(await screen.findByRole("button", { name: "Warming up..." })).toBeTruthy();
    await resolveDeferred(pendingWarmup, { accounts: [account], failures: [], succeededCount: 1, targetCount: 1 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Warm up weekly quota" })).toBeTruthy());

    const pendingRefreshAll = deferred<AccountSummary[]>();
    api.accounts.refreshAllUsage = vi.fn(() => pendingRefreshAll.promise);
    fireEvent.click(within(toolbar()).getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(toolbar().querySelector(".refresh-icon.spinning")).toBeTruthy());
    expect(rendererStyles()).toContain(".refresh-icon.spinning");
    await resolveDeferred(pendingRefreshAll, [account]);
    await waitFor(() => expect(toolbar().querySelector(".refresh-icon.spinning")).toBeNull());
  });

  it("uses desktop weekly quota warmup notice tones", async () => {
    const account = makeAccount("a", "Work");
    const api = installMockAPI({ accounts: [account] });
    render(<App />);

    expect(await screen.findByText("a@example.com")).toBeTruthy();

    api.accounts.warmUpWeeklyQuota = vi.fn(async () => ({
      accounts: [account],
      failures: [],
      succeededCount: 0,
      targetCount: 0
    }));
    fireEvent.click(screen.getByRole("button", { name: "Warm up weekly quota" }));
    expect(await screen.findByText("No accounts need weekly quota warmup")).toBeTruthy();
    expect(document.querySelector(".notice.info")?.textContent).toContain("No accounts need weekly quota warmup");

    api.accounts.warmUpWeeklyQuota = vi.fn(async () => ({
      accounts: [account],
      failures: [],
      succeededCount: 1,
      targetCount: 1
    }));
    fireEvent.click(screen.getByRole("button", { name: "Warm up weekly quota" }));
    expect(await screen.findByText("Weekly quota warmup complete: 1 succeeded, 0 failed")).toBeTruthy();
    expect(document.querySelector(".notice.success")?.textContent).toContain("Weekly quota warmup complete");

    api.accounts.warmUpWeeklyQuota = vi.fn(async () => ({
      accounts: [account],
      failures: [{ accountId: "a", label: "Work", message: "quota exceeded" }],
      succeededCount: 1,
      targetCount: 2
    }));
    fireEvent.click(screen.getByRole("button", { name: "Warm up weekly quota" }));
    expect(await screen.findByText("Weekly quota warmup finished with errors: 1 succeeded, 1 failed")).toBeTruthy();
    expect(document.querySelector(".notice.error")?.textContent).toContain("Weekly quota warmup finished with errors");
  });

  it("does not show a success notice when importing an account file is canceled", async () => {
    const api = installMockAPI({ accounts: [makeAccount("a", "Work")] });
    api.accounts.importFile = vi.fn(async () => undefined);
    render(<App />);

    expect(await screen.findByText("a@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import file" }));
    await waitFor(() => expect(api.accounts.importFile).toHaveBeenCalledOnce());

    expect(screen.queryByText("Import file complete")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Choose accounts to import" })).toBeNull();
  });

  it("imports an auth file directly through the shared Import file action", async () => {
    const api = installMockAPI({ accounts: [makeAccount("a", "Work")] });
    const imported = makeAccount("auth-file", "Auth file");
    api.accounts.importFile = vi.fn(async () => ({ kind: "auth" as const, account: imported }));
    render(<App />);

    expect(await screen.findByText("a@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import file" }));

    await waitFor(() => expect(api.accounts.importFile).toHaveBeenCalledOnce());
    await waitFor(() => expect(api.accounts.list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Account imported: Auth file")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Choose accounts to import" })).toBeNull();
  });

  it("shows usage refresh errors on account cards", async () => {
    const account = { ...makeAccount("a", "Work"), usageError: "Usage refresh failed" };
    installMockAPI({ accounts: [account] });
    render(<App />);

    expect(await screen.findByText("Usage refresh failed")).toBeTruthy();
    expect(accountRow("a@example.com").querySelector(".usage-error")?.textContent).toBe("Usage refresh failed");
    const usageError = accountRow("a@example.com").querySelector(".usage-error");
    const accountActions = accountRow("a@example.com").querySelector(".account-actions");
    if (!(usageError instanceof Node) || !(accountActions instanceof Node)) {
      throw new Error("usage error ordering elements were not found");
    }
    expect(usageError.compareDocumentPosition(accountActions)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("toggles account grid/list presentation without legacy collapse controls", async () => {
    const account = makeAccount("a", "Work");
    installMockAPI({ accounts: [account] });
    const { container } = render(<App />);

    expect(await screen.findByText("a@example.com")).toBeTruthy();
    expect(Array.from(container.querySelectorAll(".accounts-view-controls button")).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Grid view",
      "List view"
    ]);
    expect(container.querySelector(".account-row")?.classList.contains("grid")).toBe(true);
    expect(container.querySelector(".account-list")?.classList.contains("grid")).toBe(true);
    expect(screen.getByRole("button", { name: "Grid view" }).getAttribute("aria-pressed")).toBe("true");
    expect(rendererStyles()).toContain("grid-template-columns: repeat(auto-fit, minmax(220px, 280px));");
    expect(rendererStyles()).toContain("max-width: 280px;");
    expect(rendererStyles()).toContain("flex-wrap: wrap;");
    expect(rendererStyles()).toContain("min-width: max-content;");
    expect(rendererStyles()).toContain(".account-list.list");
    expect(rendererStyles()).toContain("grid-template-columns: 58px 58px minmax(0, 1fr);");
    expect(rendererStyles()).toContain("min-height: 178px;");
    expect(rendererStyles()).not.toContain(".account-row:not(.grid) .account-actions");
    expect(rendererStyles()).not.toContain(".account-row.collapsed");
    expect(rendererStyles()).not.toContain("collapsed-switch-overlay");
    expect(screen.queryByRole("button", { name: "Collapse all cards" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand all cards" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(container.querySelector(".account-row")?.classList.contains("list")).toBe(true);
    expect(container.querySelector(".account-list")?.classList.contains("list")).toBe(true);
    expect(screen.getByRole("button", { name: "List view" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".account-row")?.classList.contains("collapsed")).toBe(false);
  });

  it("does not smart-switch when the current account is already best", async () => {
    const currentAccount = { ...makeAccount("a", "Work"), isCurrent: true, usage: makeUsage(4, 6) };
    const api = installMockAPI({ accounts: [currentAccount] });
    render(<App />);

    expect(await screen.findByText("a@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Smart switch" }));

    expect(await screen.findByText("Current account is already the best available")).toBeTruthy();
    expect(api.accounts.smartSwitch).not.toHaveBeenCalled();
  });

  it("shows desktop switch and smart-switch result notices", async () => {
    const currentAccount = { ...makeAccount("a", "Work"), isCurrent: true, usage: makeUsage(99, 99) };
    const targetAccount = { ...makeAccount("b", "Personal"), usage: makeUsage(3, 5) };
    const api = installMockAPI({ accounts: [currentAccount, targetAccount] });
    api.accounts.smartSwitch = vi.fn(async () => ({
      account: targetAccount,
      execution: { restartedEditorApps: ["cursor" as const], usedFallbackCLI: true }
    }));
    api.accounts.switch = vi.fn(async () => ({
      editorRestartError: "taskkill failed",
      restartedEditorApps: [],
      usedFallbackCLI: false
    }));
    render(<App />);

    expect(await screen.findByText("a@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Smart switch" }));
    expect(
      await screen.findByText("Smart switched to: Personal · Switched account (via codex app command) · Editors restarted: cursor")
    ).toBeTruthy();

    const accountSwitchButton = within(accountRow("b@example.com")).getByRole("button", { name: "Switch to this" });
    expect(accountSwitchButton).toBeDefined();
    fireEvent.click(accountSwitchButton as HTMLElement);
    expect(await screen.findByText("Switched account · Editor restart failed: taskkill failed")).toBeTruthy();
  });

  it("starts, stops, regenerates, and copies proxy values through mocked IPC", async () => {
    const api = installMockAPI();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Proxy" }));
    expect(screen.getByRole("heading", { name: "Proxy Control" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Endpoints" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Available Models" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Usage" })).toBeTruthy();
    expect(screen.getByText("cURL example:")).toBeTruthy();
    expect(screen.getByText("Environment variables for CLI tools:")).toBeTruthy();
    const proxyControl = document.querySelector(".proxy-control") as HTMLElement;
    expect(proxyControl.querySelector(".status-pill")).toBeTruthy();
    expect(proxyControl.querySelectorAll(".proxy-form-row")).toHaveLength(2);
    expect(proxyControl.querySelector(".proxy-actions")).toBeTruthy();
    expect(rendererStyles()).toContain(".proxy-form-row");
    expect(rendererStyles()).toContain("flex: 0 0 68px;");
    const endpointRows = Array.from(document.querySelectorAll(".endpoint-row"));
    expect(endpointRows).toHaveLength(3);
    expect(endpointRows[0]?.querySelector(".endpoint-method-badge")?.textContent).toBe("POST");
    expect(endpointRows[0]?.querySelector("code")?.textContent).toBe("/v1/chat/completions");
    expect(endpointRows[0]?.querySelector("em")?.textContent).toBe("Chat completions");
    expect(endpointRows[0]?.classList.contains("selected")).toBe(true);
    expect(rendererStyles()).toContain(".endpoint-method-badge");
    expect(rendererStyles()).toContain("grid-template-columns: auto minmax(0, 1fr) auto;");
    const modelList = document.querySelector(".model-list") as HTMLElement;
    const modelChips = Array.from(modelList.querySelectorAll(".model-chip"));
    expect(modelChips).toHaveLength(proxyAvailableModels.length);
    expect(modelList.querySelector(".model-chip.selected")?.textContent).toBe("gpt-5.5");
    expect(screen.getByRole("heading", { name: "Codex.app" })).toBeTruthy();
    expect(screen.getByText("Not configured")).toBeTruthy();
    expect(rendererStyles()).toContain("flex-wrap: wrap;");
    expect(rendererStyles()).not.toContain("grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));");
    expect(codeBlockCopyButtons()).toHaveLength(2);
    expect(codeBlockCopyButtons().every((button) => button.textContent === "")).toBe(true);
    expect(codeBlockCopyButtons().every((button) => button.querySelector(".copy-doc-icon"))).toBe(true);
    const apiKeyControl = screen.getByLabelText("API Key").closest(".api-key-field")?.querySelector(".api-key-control");
    expect(apiKeyControl).toBeTruthy();
    expect(within(apiKeyControl as HTMLElement).getByRole("button", { name: "Regenerate API Key" })).toBeTruthy();
    expect(directProxyControlButtonText()).toEqual(["Start"]);
    expect(proxyUsageText()).toContain("sk-local-...");
    expect(proxyUsageText()).not.toContain("sk-local-test");
    fireEvent.click(screen.getByRole("button", { name: "gpt-5-mini" }));
    expect(document.querySelector(".model-chip.selected")?.textContent).toBe("gpt-5-mini");

    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "17888" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-local-test" } });
    expect(proxyUsageText()).toContain("sk-local-...");
    expect(proxyUsageText()).not.toContain("sk-local-test");

    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(document.querySelector(".notice.error")?.textContent).toContain("Invalid proxy port:"));
    expect(api.proxy.start).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Invalid proxy port: 0")).toBeTruthy();
    expect(document.querySelector(".notice.error")?.textContent).toContain("Invalid proxy port: 0");
    expect(api.proxy.start).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "65536" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Invalid proxy port: 65536")).toBeTruthy();
    expect(document.querySelector(".notice.error")?.textContent).toContain("Invalid proxy port: 65536");
    expect(api.proxy.start).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "17888" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(api.proxy.start).toHaveBeenCalledWith(17888, "sk-local-test"));
    expect(await screen.findByText("Running")).toBeTruthy();
    expect(await screen.findByText("Proxy started")).toBeTruthy();
    expect(document.querySelector(".sidebar-footer .sidebar-status-row")?.textContent).toBe("Proxy: Running");
    expect(directProxyControlButtonText()).toEqual(["Stop", "Copy URL"]);
    expect(proxyUsageText()).toContain("sk-local-test");

    fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));
    await waitFor(() => expect(api.clipboard.writeText).toHaveBeenCalledWith("http://localhost:17888"));
    expect(await screen.findByText("Proxy URL copied")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(api.proxy.stop).toHaveBeenCalledOnce());
    expect(await screen.findByText("Proxy stopped", { selector: ".notice-text" })).toBeTruthy();
    expect(directProxyControlButtonText()).toEqual(["Start"]);
    expect(proxyUsageText()).toContain("sk-local-...");
    await waitFor(() => expect(document.querySelector(".model-chip.selected")?.textContent).toBe("gpt-5.5"));

    fireEvent.click(await screen.findByRole("button", { name: "Regenerate API Key" }));
    await waitFor(() => expect(api.proxy.regenerateApiKey).toHaveBeenCalledOnce());
    expect(screen.queryByText("Regenerate complete")).toBeNull();

    const copyButton = screen.getAllByRole("button", { name: "Copy" })[0];
    expect(copyButton).toBeDefined();
    fireEvent.click(copyButton as HTMLElement);
    await waitFor(() => expect(api.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/v1/chat/completions")));
    expect(screen.queryByText("Copy complete")).toBeNull();
  });

  it("persists settings toggles, editor targets, and locale through mocked IPC", async () => {
    const api = installMockAPI({
      installedEditors: [
        { id: "cursor", label: "Cursor" },
        { id: "vscode", label: "VS Code" }
      ]
    });
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    expect(Array.from(container.querySelectorAll(".settings-layout h2, .settings-layout h3")).map((heading) => heading.textContent)).toEqual([
      "Settings",
      "General",
      "Switch Behavior",
      "Language"
    ]);
    expect(Array.from(container.querySelectorAll(".toggle-row > span")).map((label) => label.textContent)).toEqual([
      "Launch at startup",
      "Launch Codex after switch",
      "Auto-start API proxy on launch",
      "Auto smart switch",
      "Restart editors on switch"
    ]);
    expect(Array.from(container.querySelectorAll(".select-row > span")).map((label) => label.textContent)).toEqual([
      "Editor restart target",
      "Language"
    ]);
    expect(Array.from(container.querySelectorAll(".settings-footer button")).map((button) => button.textContent)).toEqual(["GitHub Star", "Quit"]);
    expect(container.querySelectorAll(".settings-section .toggle-row")).toHaveLength(5);
    expect(container.querySelectorAll(".settings-section .select-row")).toHaveLength(2);
    expect(rendererStyles()).toContain(".toggle-row input:checked");
    expect(rendererStyles()).toContain("transform: translateX(18px);");

    fireEvent.click(screen.getByLabelText("Launch at startup"));
    await waitFor(() => expect(api.settings.update).toHaveBeenCalledWith({ launchAtStartup: true }));
    expect(await screen.findByText("Settings updated")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Restart editors on switch"));
    await waitFor(() =>
      expect(api.settings.update).toHaveBeenCalledWith({
        restartEditorsOnSwitch: true,
        restartEditorTargets: ["cursor"]
      })
    );
    expect(await screen.findByText("Settings updated")).toBeTruthy();

    fireEvent.change(await screen.findByLabelText("Editor restart target"), { target: { value: "vscode" } });
    await waitFor(() => expect(api.settings.update).toHaveBeenCalledWith({ restartEditorTargets: ["vscode"] }));
    expect(await screen.findByText("Editor restart target updated")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh-Hans" } });
    await waitFor(() => expect(api.settings.update).toHaveBeenCalledWith({ locale: "zh-Hans" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeTruthy();
  });

  it("keeps account card action labels stable under localized UI", async () => {
    installMockAPI({ accounts: [makeAccount("a", "Work")] });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh-Hans" } });
    fireEvent.click(await screen.findByRole("button", { name: "账号" }));

    const row = screen.getByText("a@example.com").closest("article");
    expect(row).toBeTruthy();
    const accountActions = (row as HTMLElement).querySelector(".account-actions");
    expect(accountActions?.textContent).toBe("Switch刷新Delete");
    expect(within(row as HTMLElement).getByRole("button", { name: "切换到此账号" })).toBeTruthy();
    expect(within(row as HTMLElement).getByRole("button", { name: "刷新用量" })).toBeTruthy();
    expect(within(row as HTMLElement).getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("opens the repository and quits from the settings footer through mocked IPC", async () => {
    const api = installMockAPI();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    const githubButton = screen.getByRole("button", { name: "GitHub Star" });
    expect(githubButton.querySelector(".github-star-icon")).toBeTruthy();
    fireEvent.click(githubButton);
    await waitFor(() => expect(api.app.openRepository).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    await waitFor(() => expect(api.app.quit).toHaveBeenCalledOnce());
  });

  it("uses localized IPC-unavailable errors in fallback mode", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh-Hans" } });
    fireEvent.click(screen.getByRole("button", { name: "账号" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "添加账号" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "添加账号" }));

    expect(await screen.findByText("IPC 桥不可用")).toBeTruthy();
  });

  it("auto-dismisses notices with desktop-compatible timing and banner chrome", async () => {
    const api = installMockAPI({ accounts: [makeAccount("a", "Work")] });
    render(<App />);

    expect(await screen.findByText("a@example.com")).toBeTruthy();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Import current auth" }));
    await flushRendererUpdates();

    expect(screen.getByRole("status").textContent).toContain("Account imported: Current auth");
    expect(document.querySelector(".notice .notice-icon.success")).toBeTruthy();
    expect(document.querySelector(".notice .notice-close-icon")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_999));
    expect(screen.getByText("Account imported: Current auth")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Account imported: Current auth")).toBeNull();

    api.accounts.addViaLogin = vi.fn(async () => {
      throw new Error("Login failed");
    });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    await flushRendererUpdates();

    expect(screen.getByRole("alert").textContent).toContain("Login failed");
    expect(document.querySelector(".notice .notice-icon.error")).toBeTruthy();
    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.getByText("Login failed")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Login failed")).toBeNull();
  });
});

function installMockAPI(options: { accounts?: AccountSummary[]; installedEditors?: InstalledEditorApp[] } = {}): CodexManagerAPI {
  let accounts = options.accounts ?? [makeAccount("a", "Work")];
  const installedEditors = options.installedEditors ?? [];
  let settings: AppSettings = { ...defaultAppSettings(), locale: "en", proxyApiKey: "sk-local-test" };
  let proxyState = makeProxyState(settings);

  const api: CodexManagerAPI = {
    getAppInfo: vi.fn(async () => fallbackAppInfo),
    app: {
      openRepository: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined)
    },
    accounts: {
      addViaLogin: vi.fn(async () => appendAccount(accounts, "login", "OAuth")),
      delete: vi.fn(async (id) => {
        accounts = accounts.filter((account) => account.id !== id);
      }),
      exportPackage: vi.fn(async () => ({ canceled: false, path: String.raw`C:\exports\accounts.codexmanager.json` })),
      importCurrentAuth: vi.fn(async () => appendAccount(accounts, "current", "Current auth")),
      importPreparedPackage: vi.fn(async (_draftId, accountIds) => {
        for (const id of accountIds) {
          appendAccount(accounts, id, id === "package" ? "Package" : id);
        }
        return { insertedCount: accountIds.length, updatedCount: 0 };
      }),
      list: vi.fn(async () => accounts),
      onChanged: vi.fn(() => () => undefined),
      importFile: vi.fn(async () => ({
        kind: "package" as const,
        draft: {
          draftId: "draft-1",
          accounts: [accountSummaryToTransferSelectableItem(makeAccount("package", "Package"))]
        }
      })),
      refreshAllUsage: vi.fn(async () => {
        accounts = accounts.map((account) => ({ ...account, usage: makeUsage(12, 34) }));
        return accounts;
      }),
      refreshUsage: vi.fn(async (id) => {
        const updated = { ...(accounts.find((account) => account.id === id) ?? makeAccount(id, id)), usage: makeUsage(22, 44) };
        accounts = accounts.map((account) => (account.id === id ? updated : account));
        return updated;
      }),
      smartSwitch: vi.fn(async () => undefined as SmartSwitchResult | undefined),
      switch: vi.fn(async () => ({ restartedEditorApps: [], usedFallbackCLI: false })),
      warmUpWeeklyQuota: vi.fn(async () => ({
        accounts,
        failures: [],
        succeededCount: accounts.length,
        targetCount: accounts.length
      }))
    },
    clipboard: {
      writeText: vi.fn(async () => undefined)
    },
    codexApp: {
      configure: vi.fn(async () => makeCodexAppStatus(proxyState, "configured", true)),
      getStatus: vi.fn(async () => makeCodexAppStatus(proxyState)),
      restoreSafe: vi.fn(async () => makeCodexAppStatus(proxyState, "not_configured")),
      restoreSnapshot: vi.fn(async () => makeCodexAppStatus(proxyState, "not_configured"))
    },
    proxy: {
      getState: vi.fn(async () => proxyState),
      regenerateApiKey: vi.fn(async () => {
        proxyState = { ...proxyState, apiKey: "sk-local-regenerated" };
        return proxyState;
      }),
      start: vi.fn(async (port, apiKey) => {
        proxyState = { ...proxyState, apiKey, isRunning: true, port, proxyURL: `http://localhost:${port}` };
        return proxyState;
      }),
      stop: vi.fn(async () => {
        proxyState = { ...proxyState, isRunning: false };
        return proxyState;
      })
    },
    settings: {
      get: vi.fn(async () => settings),
      listEditors: vi.fn(async () => installedEditors),
      update: vi.fn(async (patch) => {
        settings = {
          ...settings,
          ...patch,
          locale: patch.locale !== undefined ? resolveAppLocale(patch.locale) : settings.locale,
          restartEditorTargets: patch.restartEditorTargets ?? settings.restartEditorTargets
        };
        return settings;
      })
    }
  };

  window.codexManager = api;
  return api;
}

function makeCodexAppStatus(
  proxyState: ProxyRuntimeState,
  state: "not_configured" | "configured" | "drifted" | "restorable" = "not_configured",
  hasBackup = false
) {
  return {
    configPath: "/Users/nik/.codex/config.toml",
    hasBackup,
    model: "gpt-5.5",
    providerId: "codexmanager",
    proxyURL: proxyState.proxyURL.replace("localhost", "127.0.0.1"),
    state
  };
}

function appendAccount(accounts: AccountSummary[], id: string, label: string): AccountSummary {
  const account = makeAccount(id, label);
  accounts.push(account);
  return account;
}

function makeProxyState(settings: AppSettings): ProxyRuntimeState {
  return {
    apiKey: settings.proxyApiKey,
    availableModels: [...proxyAvailableModels],
    isRunning: false,
    port: settings.proxyPort,
    proxyURL: `http://localhost:${settings.proxyPort}`
  };
}

function makeAccount(id: string, label: string): AccountSummary {
  return {
    id,
    accountId: `acct-${id}`,
    accountKey: `key-${id}`,
    addedAt: 1,
    displayTeamName: "Team",
    effectivePlanType: "pro",
    email: `${id}@example.com`,
    isCurrent: false,
    label,
    normalizedPlanLabel: "PRO",
    shouldDisplayWorkspaceTag: true,
    updatedAt: 2
  };
}

function accountRow(accountTitle: string): HTMLElement {
  const row = screen.getByText(accountTitle).closest("article");
  if (!row) {
    throw new Error(`Account row ${accountTitle} was not found`);
  }
  return row;
}

function proxyUsageText(): string {
  return Array.from(document.querySelectorAll(".code-block pre")).map((element) => element.textContent ?? "").join("\n");
}

function directProxyControlButtonText(): string[] {
  return Array.from(document.querySelectorAll(".proxy-actions > button")).map((element) => element.textContent ?? "");
}

function codeBlockCopyButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll(".code-block .code-copy-button"));
}

function rendererStyles(): string {
  return readFileSync("src/renderer/src/styles/app.css", "utf8");
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function resolveDeferred<T>(pending: { promise: Promise<T>; resolve: (value: T) => void }, value: T): Promise<void> {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}

async function flushRendererUpdates(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
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

function makeUsage(fiveHourUsed: number, oneWeekUsed: number): AccountSummary["usage"] {
  return {
    fetchedAt: 3,
    fiveHour: { resetAt: 10, usedPercent: fiveHourUsed, windowSeconds: 18_000 },
    oneWeek: { resetAt: 20, usedPercent: oneWeekUsed, windowSeconds: 604_800 },
    planType: "pro"
  };
}
