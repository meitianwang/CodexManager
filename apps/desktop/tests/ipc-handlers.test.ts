import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcMain } from "electron";
import { dialog } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../src/main/ipc/handlers";
import type { DesktopAppContext } from "../src/main/app-context";
import { ipcChannels } from "../src/shared/ipc/schema";
import { accountsTransferFormatIdentifier } from "../src/shared/models/account-transfer";
import type { AccountSummary, StoredAccount } from "../src/shared/models/accounts";
import type { JSONValue } from "../src/shared/models/json-value";

vi.mock("electron", () => ({
  app: { quit: vi.fn() },
  clipboard: { writeText: vi.fn() },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  shell: { openExternal: vi.fn() }
}));

const tempRoots: string[] = [];

describe("ipc handlers", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("publishes the latest accounts after account switching", async () => {
    const currentAccount = accountSummary({ id: "b", isCurrent: true });
    const context = appContext({
      listAccounts: vi.fn(async () => [currentAccount]),
      switchAccountAndApplySettings: vi.fn(async () => ({ restarted: [], error: undefined }))
    });
    const ipcMain = new FakeIpcMain();
    const published: AccountSummary[][] = [];

    registerIpcHandlers(ipcMain as unknown as IpcMain, context, {
      onAccountsChanged(accounts) {
        published.push(accounts);
      }
    });

    await ipcMain.invoke(ipcChannels.accountsSwitch, { id: "b" });

    expect(context.accountsCoordinator.switchAccountAndApplySettings).toHaveBeenCalledWith("b", undefined);
    expect(published).toEqual([[currentAccount]]);
  });

  it("publishes refreshed accounts without an extra list request", async () => {
    const refreshedAccounts = [accountSummary({ id: "a", isCurrent: true })];
    const listAccounts = vi.fn(async () => []);
    const context = appContext({
      listAccounts,
      refreshAllUsage: vi.fn(async () => refreshedAccounts)
    });
    const ipcMain = new FakeIpcMain();
    const published: AccountSummary[][] = [];

    registerIpcHandlers(ipcMain as unknown as IpcMain, context, {
      onAccountsChanged(accounts) {
        published.push(accounts);
      }
    });

    await expect(ipcMain.invoke(ipcChannels.accountsRefreshAllUsage)).resolves.toEqual(refreshedAccounts);
    expect(listAccounts).not.toHaveBeenCalled();
    expect(published).toEqual([refreshedAccounts]);
  });

  it("allows interactive OAuth repair for single-account manual usage refreshes", async () => {
    const refreshedAccount = accountSummary({ id: "a", isCurrent: true });
    const latest = [refreshedAccount];
    const context = appContext({
      listAccounts: vi.fn(async () => latest),
      refreshAccountUsage: vi.fn(async () => refreshedAccount)
    });
    const ipcMain = new FakeIpcMain();

    registerIpcHandlers(ipcMain as unknown as IpcMain, context);

    await expect(ipcMain.invoke(ipcChannels.accountsRefreshUsage, { id: "a" })).resolves.toEqual(refreshedAccount);
    expect(context.accountsCoordinator.refreshAccountUsage).toHaveBeenCalledWith("a", {
      allowInteractiveAuthRepair: true
    });
  });

  it("routes Codex app integration actions through the main service", async () => {
    const codexAppStatus = {
      configPath: "/Users/nik/.codex/config.toml",
      hasBackup: true,
      model: "gpt-5.5",
      providerId: "codexmanager",
      proxyURL: "http://127.0.0.1:18317",
      state: "configured"
    };
    const proxyState = {
      apiKey: "sk-local-test",
      availableModels: ["gpt-5.5"],
      isRunning: true,
      port: 18_317,
      proxyURL: "http://localhost:18317"
    };
    const context = appContext(
      {
        listAccounts: vi.fn(async () => [accountSummary()])
      },
      {
        codexAppIntegrationService: {
          configure: vi.fn(async () => codexAppStatus),
          restoreSafe: vi.fn(async () => ({ ...codexAppStatus, state: "not_configured" })),
          restoreSnapshot: vi.fn(async () => ({ ...codexAppStatus, state: "not_configured" })),
          status: vi.fn(async () => codexAppStatus)
        },
        proxyRuntimeService: {
          getState: vi.fn(async () => proxyState),
          start: vi.fn(async () => proxyState)
        }
      }
    );
    const ipcMain = new FakeIpcMain();
    const publishedProxyStates: unknown[] = [];
    const fetchMock = stubCodexAppProxyHealth();

    registerIpcHandlers(ipcMain as unknown as IpcMain, context, {
      onProxyStateChanged(state) {
        publishedProxyStates.push(state);
      }
    });

    await expect(ipcMain.invoke(ipcChannels.codexAppGetStatus)).resolves.toEqual(codexAppStatus);
    await expect(ipcMain.invoke(ipcChannels.codexAppConfigure)).resolves.toEqual(codexAppStatus);
    await expect(ipcMain.invoke(ipcChannels.codexAppRestoreSafe)).resolves.toMatchObject({ state: "not_configured" });
    await expect(ipcMain.invoke(ipcChannels.codexAppRestoreSnapshot)).resolves.toMatchObject({ state: "not_configured" });
    expect(context.codexAppIntegrationService.configure).toHaveBeenCalledTimes(1);
    expect(context.proxyRuntimeService.getState).toHaveBeenCalledTimes(1);
    expect(context.proxyRuntimeService.start).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:18317/health",
      expect.objectContaining({
        method: "GET"
      })
    );
    expect(publishedProxyStates).toEqual([proxyState]);
  });

  it("starts the proxy before configuring Codex app when the proxy is stopped", async () => {
    const codexAppStatus = {
      configPath: "/Users/nik/.codex/config.toml",
      hasBackup: true,
      model: "gpt-5.5",
      providerId: "codexmanager",
      proxyURL: "http://127.0.0.1:18317",
      state: "configured"
    };
    const stoppedProxyState = {
      apiKey: "sk-local-test",
      availableModels: ["gpt-5.5"],
      isRunning: false,
      port: 18_317,
      proxyURL: "http://localhost:18317"
    };
    const runningProxyState = {
      ...stoppedProxyState,
      isRunning: true
    };
    const context = appContext(
      {
        listAccounts: vi.fn(async () => [accountSummary()])
      },
      {
        codexAppIntegrationService: {
          configure: vi.fn(async () => codexAppStatus)
        },
        proxyRuntimeService: {
          getState: vi.fn(async () => stoppedProxyState),
          start: vi.fn(async () => runningProxyState)
        }
      }
    );
    const ipcMain = new FakeIpcMain();
    const publishedProxyStates: unknown[] = [];
    stubCodexAppProxyHealth();

    registerIpcHandlers(ipcMain as unknown as IpcMain, context, {
      onProxyStateChanged(state) {
        publishedProxyStates.push(state);
      }
    });

    await expect(ipcMain.invoke(ipcChannels.codexAppConfigure)).resolves.toEqual(codexAppStatus);

    expect(context.proxyRuntimeService.start).toHaveBeenCalledWith(18_317, "sk-local-test");
    expect(context.codexAppIntegrationService.configure).toHaveBeenCalledOnce();
    expect(publishedProxyStates).toEqual([runningProxyState]);
  });

  it("does not write Codex app config when the local proxy health check fails", async () => {
    const codexAppStatus = {
      configPath: "/Users/nik/.codex/config.toml",
      hasBackup: true,
      model: "gpt-5.5",
      providerId: "codexmanager",
      proxyURL: "http://127.0.0.1:18317",
      state: "configured"
    };
    const proxyState = {
      apiKey: "sk-local-test",
      availableModels: ["gpt-5.5"],
      isRunning: true,
      port: 18_317,
      proxyURL: "http://localhost:18317"
    };
    const context = appContext(
      {
        listAccounts: vi.fn(async () => [accountSummary()])
      },
      {
        codexAppIntegrationService: {
          configure: vi.fn(async () => codexAppStatus)
        },
        proxyRuntimeService: {
          getState: vi.fn(async () => proxyState),
          start: vi.fn(async () => proxyState)
        }
      }
    );
    const ipcMain = new FakeIpcMain();
    stubCodexAppProxyHealth(503, {
      error: {
        message: "Proxy is unavailable",
        type: "proxy_error"
      }
    });

    registerIpcHandlers(ipcMain as unknown as IpcMain, context);

    await expect(ipcMain.invoke(ipcChannels.codexAppConfigure)).rejects.toThrow(
      "Codex.app proxy health check failed (503): Proxy is unavailable"
    );
    expect(context.codexAppIntegrationService.configure).not.toHaveBeenCalled();
  });

  it("rejects Codex app configuration before an account is available", async () => {
    const context = appContext(
      {
        listAccounts: vi.fn(async () => [])
      },
      {
        codexAppIntegrationService: {
          configure: vi.fn(async () => ({ state: "configured" }))
        },
        proxyRuntimeService: {
          getState: vi.fn(async () => undefined),
          start: vi.fn(async () => undefined)
        }
      }
    );
    const ipcMain = new FakeIpcMain();

    registerIpcHandlers(ipcMain as unknown as IpcMain, context);

    await expect(ipcMain.invoke(ipcChannels.codexAppConfigure)).rejects.toThrow("Add and authorize at least one account");
    expect(context.codexAppIntegrationService.configure).not.toHaveBeenCalled();
    expect(context.proxyRuntimeService.getState).not.toHaveBeenCalled();
    expect(context.proxyRuntimeService.start).not.toHaveBeenCalled();
  });

  it("imports selected auth JSON files directly from the shared import file dialog", async () => {
    const root = await makeTempRoot();
    const authPath = join(root, "auth.json");
    const authJson: JSONValue = {
      auth_mode: "chatgpt",
      tokens: {
        access_token: "access",
        id_token: "id",
        refresh_token: "refresh",
        account_id: "acct-auth-file"
      }
    };
    await writeFile(authPath, JSON.stringify(authJson), "utf8");
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [authPath] });

    const imported = accountSummary({ id: "auth-file", label: "Auth file" });
    const latest = [imported];
    const context = appContext({
      importAccount: vi.fn(async () => imported),
      listAccounts: vi.fn(async () => latest)
    });
    const ipcMain = new FakeIpcMain();
    const published: AccountSummary[][] = [];

    registerIpcHandlers(ipcMain as unknown as IpcMain, context, {
      onAccountsChanged(accounts) {
        published.push(accounts);
      }
    });

    await expect(ipcMain.invoke(ipcChannels.accountsImportFile)).resolves.toEqual({ kind: "auth", account: imported });
    expect(context.accountsCoordinator.importAccount).toHaveBeenCalledWith(authJson);
    expect(published).toEqual([latest]);
  });

  it("returns selectable transfer package drafts from the shared import file dialog", async () => {
    const root = await makeTempRoot();
    const packagePath = join(root, "accounts.json");
    const account = storedAccount();
    await writeFile(
      packagePath,
      JSON.stringify({
        format: accountsTransferFormatIdentifier,
        version: 1,
        exportedAt: 1_780_000_000,
        accounts: [account]
      }),
      "utf8"
    );
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [packagePath] });

    const context = appContext({
      importAccount: vi.fn(),
      listAccounts: vi.fn()
    });
    const ipcMain = new FakeIpcMain();
    const published: AccountSummary[][] = [];

    registerIpcHandlers(ipcMain as unknown as IpcMain, context, {
      onAccountsChanged(accounts) {
        published.push(accounts);
      }
    });

    const result = await ipcMain.invoke(ipcChannels.accountsImportFile);

    expect(result).toMatchObject({
      kind: "package",
      draft: {
        draftId: expect.any(String),
        accounts: [
          {
            id: "package",
            label: "Package",
            email: "package@example.com",
            accountId: "acct-package",
            planLabel: "PRO",
            isCurrent: false
          }
        ]
      }
    });
    expect(context.accountsCoordinator.importAccount).not.toHaveBeenCalled();
    expect(published).toEqual([]);
  });
});

class FakeIpcMain {
  private readonly handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();

  handle(channel: string, handler: (event: unknown, input?: unknown) => unknown): void {
    this.handlers.set(channel, handler);
  }

  async invoke(channel: string, input?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`No IPC handler registered for ${channel}`);
    }
    return handler({}, input);
  }
}

function stubCodexAppProxyHealth(status = 200, body: unknown = { status: "ok" }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function appContext(accountsCoordinator: Record<string, unknown>, patch: Record<string, unknown> = {}): DesktopAppContext {
  return {
    accountsCoordinator,
    editorAppService: {},
    proxyRuntimeService: {},
    settingsCoordinator: {},
    ...patch
  } as unknown as DesktopAppContext;
}

function accountSummary(patch: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: "account",
    label: "Account",
    accountId: "acct",
    addedAt: 1,
    updatedAt: 1,
    isCurrent: false,
    accountKey: "acct",
    effectivePlanType: "pro",
    normalizedPlanLabel: "Pro",
    shouldDisplayWorkspaceTag: false,
    ...patch
  };
}

function storedAccount(patch: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id: "package",
    label: "Package",
    email: "package@example.com",
    accountId: "acct-package",
    planType: "pro",
    authJson: {
      tokens: {
        access_token: "access",
        id_token: "id",
        refresh_token: "refresh"
      }
    },
    addedAt: 1,
    updatedAt: 2,
    principalId: "package@example.com",
    ...patch
  };
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codexmanager-ipc-"));
  tempRoots.push(root);
  return root;
}
