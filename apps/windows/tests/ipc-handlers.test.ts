import type { IpcMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../src/main/ipc/handlers";
import type { WindowsAppContext } from "../src/main/app-context";
import { ipcChannels } from "../src/shared/ipc/schema";
import type { AccountSummary } from "../src/shared/models/accounts";

vi.mock("electron", () => ({
  app: { quit: vi.fn() },
  clipboard: { writeText: vi.fn() },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  shell: { openExternal: vi.fn() }
}));

describe("ipc handlers", () => {
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

function appContext(accountsCoordinator: Record<string, unknown>): WindowsAppContext {
  return {
    accountsCoordinator,
    editorAppService: {},
    proxyRuntimeService: {},
    settingsCoordinator: {}
  } as unknown as WindowsAppContext;
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
