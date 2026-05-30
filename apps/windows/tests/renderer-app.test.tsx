import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appInfo as fallbackAppInfo } from "../src/shared/app-info";
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
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeTruthy();
    expect(screen.getByText("Add ChatGPT OAuth or import an existing Codex auth file.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Proxy" }));
    expect(container.querySelector(".app-shell")?.getAttribute("data-active-page")).toBe("proxy");
    expect(screen.getByRole("heading", { name: "Proxy" })).toBeTruthy();
    expect(screen.getByText("/v1/chat/completions")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(container.querySelector(".app-shell")?.getAttribute("data-active-page")).toBe("settings");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Launch at startup")).toBeTruthy();
  });

  it("drives account import, export, delete, refresh, and switch actions through mocked IPC", async () => {
    const account = makeAccount("a", "Work");
    const api = installMockAPI({ accounts: [account] });
    render(<App />);

    expect(await screen.findByText("Work")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(api.accounts.addViaLogin).toHaveBeenCalledOnce());
    await waitFor(() => expect(api.accounts.list).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Import current" }));
    await waitFor(() => expect(api.accounts.importCurrentAuth).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Import file" }));
    await waitFor(() => expect(api.accounts.importAuthFile).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Import package" }));
    await waitFor(() => expect(api.accounts.importPackage).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByLabelText("Selected Work"));
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(api.accounts.exportPackage).toHaveBeenCalledWith(["a"]));

    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(api.accounts.refreshAllUsage).toHaveBeenCalledOnce());

    const accountRefreshButton = screen.getAllByRole("button", { name: "Refresh" })[0];
    expect(accountRefreshButton).toBeDefined();
    fireEvent.click(accountRefreshButton as HTMLElement);
    await waitFor(() => expect(api.accounts.refreshUsage).toHaveBeenCalledWith("a"));

    fireEvent.click(screen.getByRole("button", { name: "Smart switch" }));
    await waitFor(() => expect(api.accounts.smartSwitch).toHaveBeenCalledOnce());

    const accountSwitchButton = screen.getAllByRole("button", { name: "Switch" })[0];
    expect(accountSwitchButton).toBeDefined();
    fireEvent.click(accountSwitchButton as HTMLElement);
    await waitFor(() => expect(api.accounts.switch).toHaveBeenCalledWith("a"));

    fireEvent.change(screen.getByLabelText("Team alias Work"), { target: { value: "Platform" } });
    fireEvent.blur(screen.getByLabelText("Team alias Work"));
    await waitFor(() => expect(api.accounts.updateTeamAlias).toHaveBeenCalledWith("a", "Platform"));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.accounts.delete).toHaveBeenCalledWith("a"));
  });

  it("starts, stops, regenerates, and copies proxy values through mocked IPC", async () => {
    const api = installMockAPI();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Proxy" }));

    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "17888" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-local-test" } });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(api.proxy.start).toHaveBeenCalledWith(17888, "sk-local-test"));
    expect(await screen.findByText("Running")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(api.proxy.stop).toHaveBeenCalledOnce());

    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(api.proxy.regenerateApiKey).toHaveBeenCalledOnce());

    const copyButton = screen.getAllByRole("button", { name: "Copy" })[0];
    expect(copyButton).toBeDefined();
    fireEvent.click(copyButton as HTMLElement);
    await waitFor(() => expect(api.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/v1/chat/completions")));
  });

  it("persists settings toggles, editor targets, and locale through mocked IPC", async () => {
    const api = installMockAPI({
      installedEditors: [{ id: "cursor", label: "Cursor" }]
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    fireEvent.click(screen.getByLabelText("Launch at startup"));
    await waitFor(() => expect(api.settings.update).toHaveBeenCalledWith({ launchAtStartup: true }));

    fireEvent.click(screen.getByLabelText("Restart editors after switching"));
    await waitFor(() => expect(api.settings.update).toHaveBeenCalledWith({ restartEditorsOnSwitch: true }));

    fireEvent.click(await screen.findByLabelText("Cursor"));
    await waitFor(() => expect(api.settings.update).toHaveBeenCalledWith({ restartEditorTargets: ["cursor"] }));

    fireEvent.change(screen.getByLabelText("Application language"), { target: { value: "zh-Hans" } });
    await waitFor(() => expect(api.settings.update).toHaveBeenCalledWith({ locale: "zh-Hans" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeTruthy();
  });

  it("uses localized IPC-unavailable errors in fallback mode", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Application language"), { target: { value: "zh-Hans" } });
    fireEvent.click(screen.getByRole("button", { name: "账号" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "登录" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

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
    accounts: {
      addViaLogin: vi.fn(async () => appendAccount(accounts, "login", "OAuth")),
      delete: vi.fn(async (id) => {
        accounts = accounts.filter((account) => account.id !== id);
      }),
      exportPackage: vi.fn(async () => ({ canceled: false, path: String.raw`C:\exports\accounts.codexmanager.json` })),
      importAuthFile: vi.fn(async () => appendAccount(accounts, "file", "Imported file")),
      importCurrentAuth: vi.fn(async () => appendAccount(accounts, "current", "Current auth")),
      importPackage: vi.fn(async () => {
        accounts = [...accounts, makeAccount("package", "Package")];
        return { insertedCount: 1, updatedCount: 0 };
      }),
      list: vi.fn(async () => accounts),
      onChanged: vi.fn(() => () => undefined),
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

function makeUsage(fiveHourUsed: number, oneWeekUsed: number): AccountSummary["usage"] {
  return {
    fetchedAt: 3,
    fiveHour: { resetAt: 10, usedPercent: fiveHourUsed, windowSeconds: 18_000 },
    oneWeek: { resetAt: 20, usedPercent: oneWeekUsed, windowSeconds: 604_800 },
    planType: "pro"
  };
}
