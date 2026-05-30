import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appInfo as fallbackAppInfo } from "../src/shared/app-info";
import type { AccountTransferSelectableItem } from "../src/shared/models/account-transfer";
import type { AccountSummary } from "../src/shared/models/accounts";
import type { InstalledEditorApp, SmartSwitchResult } from "../src/shared/models/app";
import { proxyAvailableModels, type ProxyRuntimeState } from "../src/shared/models/proxy";
import { defaultAppSettings, resolveAppLocale, type AppSettings } from "../src/shared/models/settings";
import type { CodexManagerAPI } from "../src/preload";
import App from "../src/renderer/src/App";

describe("Windows renderer app", () => {
  afterEach(() => {
    cleanup();
    window.codexManager = undefined;
    vi.restoreAllMocks();
  });

  it("renders the accounts workspace and navigates to proxy and settings without IPC", () => {
    const { container } = render(<App />);

    expect(container.querySelector(".app-shell")?.getAttribute("data-active-page")).toBe("accounts");
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

  it("drives account import, export, delete, refresh, and switch actions through mocked IPC", async () => {
    const account = makeAccount("a", "Work");
    const api = installMockAPI({ accounts: [account] });
    const { container } = render(<App />);

    expect(await screen.findByLabelText("Team alias Work")).toBeTruthy();
    expect(within(accountRow("Work")).getByText("a@example.com")).toBeTruthy();
    expect(accountRow("Work").querySelector(".account-card-header")?.textContent).toContain("Pro");
    expect(accountRow("Work").querySelector(".account-card-header .ellipsis-icon")).toBeTruthy();
    expect(accountRow("Work").querySelector(".account-title-line")?.textContent).toBe("a@example.com");
    expect(accountRow("Work").querySelector(".account-identifier")).toBeNull();
    expect(accountRow("Work").querySelector(".account-actions")?.textContent).toBe("SwitchRefreshDelete");
    expect(accountRow("Work").querySelector(".account-actions .switch-icon")).toBeTruthy();
    expect(accountRow("Work").querySelector(".account-actions .refresh-icon")).toBeTruthy();
    expect(accountRow("Work").querySelector(".account-actions .trash-icon")).toBeTruthy();
    expect(within(accountRow("Work")).getAllByText("5h").length).toBeGreaterThanOrEqual(1);
    expect(within(accountRow("Work")).getAllByText("1 week").length).toBeGreaterThanOrEqual(1);
    expect(Array.from(container.querySelectorAll(".toolbar button")).map((button) => button.textContent)).toEqual([
      "Export accounts",
      "Import file",
      "Import current auth",
      "Add account",
      "Smart switch",
      "Warm up weekly quota",
      "Refresh usage"
    ]);

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
    await waitFor(() => expect(api.accounts.prepareImportPackage).toHaveBeenCalledOnce());
    const importDialog = await screen.findByRole("dialog", { name: "Choose accounts to import" });
    expect((within(importDialog).getByLabelText("Selected Package") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(importDialog).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(api.accounts.importPreparedPackage).toHaveBeenCalledWith("draft-1", ["package"]));
    expect(await screen.findByText("Imported 1 accounts, updated 0")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(api.accounts.refreshAllUsage).toHaveBeenCalledOnce());
    expect(await screen.findByText("Accounts refreshed")).toBeTruthy();
    expect(within(accountRow("Work")).getByText("88%")).toBeTruthy();
    expect(within(accountRow("Work")).getByText("66%")).toBeTruthy();
    expect(within(accountRow("Work")).getByText("Used 12%")).toBeTruthy();
    expect(within(accountRow("Work")).getByText("Used 34%")).toBeTruthy();
    expect(accountRow("Work").querySelectorAll(".quota-ring")).toHaveLength(2);
    expect(accountRow("Work").querySelector(".usage-track")).toBeNull();
    expect(within(accountRow("Work")).getByText("Reset")).toBeTruthy();
    const resetRows = Array.from(accountRow("Work").querySelectorAll(".reset-row")).map((row) => row.textContent ?? "");
    expect(resetRows).toHaveLength(2);
    expect(resetRows[0]).toContain("5h");
    expect(resetRows[0]).not.toContain("--");
    expect(resetRows[1]).toContain("1 week");
    expect(resetRows[1]).not.toContain("--");

    const accountRefreshButton = within(accountRow("Work")).getByRole("button", { name: "Refresh" });
    expect(accountRefreshButton).toBeDefined();
    fireEvent.click(accountRefreshButton as HTMLElement);
    await waitFor(() => expect(api.accounts.refreshUsage).toHaveBeenCalledWith("a"));
    expect(await screen.findByText("Usage refreshed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Smart switch" }));
    await waitFor(() => expect(api.accounts.smartSwitch).toHaveBeenCalledOnce());

    const accountSwitchButton = within(accountRow("Work")).getByRole("button", { name: "Switch" });
    expect(accountSwitchButton).toBeDefined();
    fireEvent.click(accountSwitchButton as HTMLElement);
    await waitFor(() => expect(api.accounts.switch).toHaveBeenCalledWith("a"));

    fireEvent.change(screen.getByLabelText("Team alias Work"), { target: { value: "Platform" } });
    fireEvent.blur(screen.getByLabelText("Team alias Work"));
    await waitFor(() => expect(api.accounts.updateTeamAlias).toHaveBeenCalledWith("a", "Platform"));
    expect(await screen.findByText("Team name updated")).toBeTruthy();

    const accountDeleteButton = within(accountRow("Work")).getByRole("button", { name: "Delete" });
    expect(accountDeleteButton).toBeDefined();
    fireEvent.click(accountDeleteButton as HTMLElement);
    await waitFor(() => expect(api.accounts.delete).toHaveBeenCalledWith("a"));
    expect(await screen.findByText("Account deleted")).toBeTruthy();
  });

  it("does not show a success notice when importing an account file is canceled", async () => {
    const api = installMockAPI({ accounts: [makeAccount("a", "Work")] });
    api.accounts.prepareImportPackage = vi.fn(async () => undefined);
    render(<App />);

    expect(await screen.findByLabelText("Team alias Work")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import file" }));
    await waitFor(() => expect(api.accounts.prepareImportPackage).toHaveBeenCalledOnce());

    expect(screen.queryByText("Import file complete")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Choose accounts to import" })).toBeNull();
  });

  it("toggles account grid/list presentation and collapse state", async () => {
    const account = makeAccount("a", "Work");
    installMockAPI({ accounts: [account] });
    const { container } = render(<App />);

    expect(await screen.findByLabelText("Team alias Work")).toBeTruthy();
    expect(container.querySelector(".account-row")?.classList.contains("grid")).toBe(true);
    expect(screen.getByRole("button", { name: "Grid view" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(container.querySelector(".account-row")?.classList.contains("list")).toBe(true);
    expect(screen.getByRole("button", { name: "List view" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Collapse all cards" }));
    expect(container.querySelector(".account-row")?.classList.contains("collapsed")).toBe(true);
    expect(container.querySelector(".account-row.collapsed .compact-usage-row")).toBeTruthy();
    expect(container.querySelectorAll(".account-row.collapsed .quota-ring")).toHaveLength(2);
    expect(container.querySelector(".account-row.collapsed .reset-cell")).toBeNull();
    expect(container.querySelector(".account-row.collapsed .account-actions")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand all cards" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Expand all cards" }));
    expect(container.querySelector(".account-row")?.classList.contains("collapsed")).toBe(false);
  });

  it("skips smart switch when the current account is already best", async () => {
    const currentAccount = { ...makeAccount("a", "Work"), isCurrent: true, usage: makeUsage(4, 6) };
    const api = installMockAPI({ accounts: [currentAccount] });
    render(<App />);

    expect(await screen.findByLabelText("Team alias Work")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Smart switch" }));

    expect(await screen.findByText("Current account is already the best available")).toBeTruthy();
    expect(api.accounts.smartSwitch).not.toHaveBeenCalled();
  });

  it("shows mac-aligned switch and smart-switch result notices", async () => {
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

    expect(await screen.findByLabelText("Team alias Work")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Smart switch" }));
    expect(
      await screen.findByText("Smart switched to: Personal · Switched account (via codex app command) · Editors restarted: cursor")
    ).toBeTruthy();

    const accountSwitchButton = within(accountRow("Personal")).getByRole("button", { name: "Switch" });
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
    expect(codeBlockCopyButtons()).toHaveLength(2);
    expect(codeBlockCopyButtons().every((button) => button.textContent === "")).toBe(true);
    expect(codeBlockCopyButtons().every((button) => button.querySelector(".copy-doc-icon"))).toBe(true);
    const apiKeyControl = screen.getByLabelText("API key").closest(".api-key-field")?.querySelector(".api-key-control");
    expect(apiKeyControl).toBeTruthy();
    expect(within(apiKeyControl as HTMLElement).getByRole("button", { name: "Regenerate API Key" })).toBeTruthy();
    expect(directProxyControlButtonText()).toEqual(["Start"]);
    expect(proxyUsageText()).toContain("sk-local-...");
    expect(proxyUsageText()).not.toContain("sk-local-test");

    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "17888" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-local-test" } });
    expect(proxyUsageText()).toContain("sk-local-...");
    expect(proxyUsageText()).not.toContain("sk-local-test");

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(api.proxy.start).toHaveBeenCalledWith(17888, "sk-local-test"));
    expect(await screen.findByText("Running")).toBeTruthy();
    expect(await screen.findByText("Proxy started")).toBeTruthy();
    expect(directProxyControlButtonText()).toEqual(["Stop", "Copy URL"]);
    expect(proxyUsageText()).toContain("sk-local-test");

    fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));
    await waitFor(() => expect(api.clipboard.writeText).toHaveBeenCalledWith("http://localhost:17888"));
    expect(await screen.findByText("Proxy URL copied")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(api.proxy.stop).toHaveBeenCalledOnce());
    expect(await screen.findByText("Proxy stopped", { selector: ".notice" })).toBeTruthy();
    expect(directProxyControlButtonText()).toEqual(["Start"]);
    expect(proxyUsageText()).toContain("sk-local-...");

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
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

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

  it("opens the repository and quits from the settings footer through mocked IPC", async () => {
    const api = installMockAPI();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    fireEvent.click(screen.getByRole("button", { name: "GitHub Star" }));
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
      importAuthFile: vi.fn(async () => appendAccount(accounts, "file", "Imported file")),
      importCurrentAuth: vi.fn(async () => appendAccount(accounts, "current", "Current auth")),
      importPreparedPackage: vi.fn(async (_draftId, accountIds) => {
        for (const id of accountIds) {
          appendAccount(accounts, id, id === "package" ? "Package" : id);
        }
        return { insertedCount: accountIds.length, updatedCount: 0 };
      }),
      importPackage: vi.fn(async () => {
        accounts = [...accounts, makeAccount("package", "Package")];
        return { insertedCount: 1, updatedCount: 0 };
      }),
      list: vi.fn(async () => accounts),
      onChanged: vi.fn(() => () => undefined),
      prepareImportPackage: vi.fn(async () => ({
        draftId: "draft-1",
        accounts: [accountSummaryToTransferSelectableItem(makeAccount("package", "Package"))]
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
      refreshWorkspaceMetadata: vi.fn(async () => accounts),
      smartSwitch: vi.fn(async () => undefined as SmartSwitchResult | undefined),
      switch: vi.fn(async () => ({ restartedEditorApps: [], usedFallbackCLI: false })),
      updateTeamAlias: vi.fn(async (id, alias) => {
        const updated = { ...(accounts.find((account) => account.id === id) ?? makeAccount(id, id)), teamAlias: alias };
        accounts = accounts.map((account) => (account.id === id ? updated : account));
        return updated;
      }),
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
    normalizedPlanLabel: "Pro",
    shouldDisplayWorkspaceTag: true,
    updatedAt: 2
  };
}

function accountRow(label: string): HTMLElement {
  const row = screen.getByLabelText(`Team alias ${label}`).closest("article");
  if (!row) {
    throw new Error(`Account row ${label} was not found`);
  }
  return row;
}

function proxyUsageText(): string {
  return Array.from(document.querySelectorAll(".code-block pre")).map((element) => element.textContent ?? "").join("\n");
}

function directProxyControlButtonText(): string[] {
  return Array.from(document.querySelectorAll(".proxy-control > button")).map((element) => element.textContent ?? "");
}

function codeBlockCopyButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll(".code-block .code-copy-button"));
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
