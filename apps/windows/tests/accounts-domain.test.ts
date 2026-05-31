import { describe, expect, it } from "vitest";
import type { JSONValue } from "../src/shared/models/json-value";
import type { AccountSummary, AccountsStore, StoredAccount } from "../src/shared/models/accounts";
import type { ChatGPTOAuthTokens, ExtractedAuth, WorkspaceMetadata } from "../src/shared/models/auth";
import type { UsageSnapshot } from "../src/shared/models/usage";
import type {
  AccountsStoreRepositoryLike,
  AuthRepositoryLike,
  ChatGPTOAuthLoginServiceLike,
  CodexCLIServiceLike,
  EditorAppServiceLike,
  SettingsRepositoryLike,
  UsageServiceLike,
  WeeklyQuotaWarmupServiceLike,
  WorkspaceMetadataServiceLike
} from "../src/main/services/accounts-coordinator";
import { AccountsCoordinator } from "../src/main/services/accounts-coordinator";
import { defaultAppSettings, type AppSettings, type EditorAppID } from "../src/shared/models/settings";
import { accountKeyForStoredAccount } from "../src/shared/domain/account-identity";
import {
  pickAutoSwitchTarget,
  pickBestAccount,
  sortForDisplay
} from "../src/shared/domain/account-ranking";
import { targetUsageRefreshAccountIds } from "../src/shared/domain/accounts-usage-refresh-planning";
import { applyAccountsTransferMerge } from "../src/shared/domain/accounts-transfer-merge";
import { pickNearestWindow } from "../src/shared/domain/usage-window-selector";
import { UnauthorizedError } from "../src/main/services/network-errors";

describe("account ranking", () => {
  it("picks the account with the most remaining quota", () => {
    const best = makeSummary({ id: "a", weekUsed: 15, hourUsed: 30 });
    const medium = makeSummary({ id: "b", weekUsed: 40, hourUsed: 30 });
    const worst = makeSummary({ id: "c", weekUsed: 80, hourUsed: 90 });

    expect(pickBestAccount([worst, medium, best])?.id).toBe(best.id);
  });

  it("pins the current account before remaining quota order", () => {
    const current = makeSummary({ id: "current", weekUsed: 95, hourUsed: 95, isCurrent: true });
    const best = makeSummary({ id: "best", weekUsed: 10, hourUsed: 10 });
    const medium = makeSummary({ id: "medium", weekUsed: 40, hourUsed: 40 });

    expect(sortForDisplay([medium, best, current]).map((account) => account.id)).toEqual([
      "current",
      "best",
      "medium"
    ]);
  });

  it("only auto-switches when the current account is exhausted", () => {
    const current = makeSummary({ id: "current", weekUsed: 100, hourUsed: 95, isCurrent: true });
    const best = makeSummary({ id: "best", weekUsed: 20, hourUsed: 15 });
    const other = makeSummary({ id: "other", weekUsed: 40, hourUsed: 25 });

    expect(pickAutoSwitchTarget([current, other, best])?.id).toBe(best.id);
    expect(pickAutoSwitchTarget([best, other])).toBeUndefined();
  });
});

describe("usage window selector", () => {
  it("selects the window nearest to the requested duration", () => {
    const selected = pickNearestWindow(
      [
        { usedPercent: 40, limitWindowSeconds: 5 * 60 * 60, resetAt: 123 },
        { usedPercent: 20, limitWindowSeconds: 7 * 24 * 60 * 60, resetAt: 456 }
      ],
      5 * 60 * 60
    );

    expect(selected?.limitWindowSeconds).toBe(5 * 60 * 60);
    expect(pickNearestWindow([], 100)).toBeUndefined();
  });
});

describe("usage refresh planning", () => {
  it("targets the current account plus non-current accounts with errors or imminent resets", () => {
    const now = 1_780_000_000;
    const current = makeSummary({ id: "current", weekUsed: 20, hourUsed: 30, isCurrent: true });
    const failed = { ...makeSummary({ id: "failed", weekUsed: 20, hourUsed: 30 }), usageError: "refresh failed" };
    const resetSoon = {
      ...makeSummary({ id: "reset-soon", weekUsed: 20, hourUsed: 30 }),
      usage: makeUsageSnapshotWithReset(now + 60)
    };
    const resetLater = {
      ...makeSummary({ id: "reset-later", weekUsed: 20, hourUsed: 30 }),
      usage: makeUsageSnapshotWithReset(now + 61)
    };
    const staleButNotResetting = makeSummary({ id: "idle", weekUsed: 20, hourUsed: 30 });

    expect(targetUsageRefreshAccountIds([staleButNotResetting, resetSoon, current, failed, resetLater], now)).toEqual([
      "current",
      "reset-soon",
      "failed"
    ]);
  });

  it("does not target non-current accounts only because their usage is stale", () => {
    const now = 1_780_000_000;
    const staleUsage = { ...makeUsageSnapshot("team", 20, 30), fetchedAt: now - 1_000 };
    const account = {
      ...makeSummary({ id: "idle", weekUsed: 20, hourUsed: 30 }),
      usage: staleUsage
    };

    expect(targetUsageRefreshAccountIds([account], now)).toEqual([]);
  });
});

describe("accounts transfer merge", () => {
  it("updates matching accounts and inserts new accounts", () => {
    const existing = makeStoredAccount({
      id: "local-1",
      email: "dev@example.com",
      accountId: "acct-1",
      label: "Local",
      updatedAt: 10,
      principalId: "dev@example.com"
    });
    const updated = makeStoredAccount({
      id: "remote-1",
      email: "dev@example.com",
      accountId: "acct-1",
      label: "Remote",
      updatedAt: 20,
      principalId: "dev@example.com"
    });
    const inserted = makeStoredAccount({
      id: "remote-2",
      email: "new@example.com",
      accountId: "acct-2",
      label: "New",
      updatedAt: 20,
      principalId: "new@example.com"
    });

    const merge = applyAccountsTransferMerge(
      [updated, inserted],
      new Set(["remote-1", "remote-2"]),
      { version: 1, accounts: [existing] },
      99,
      { idGenerator: () => "generated" }
    );

    expect(merge.result).toEqual({ insertedCount: 1, updatedCount: 1 });
    expect(merge.store.accounts.map((account) => account.id)).toEqual(["local-1", "remote-2"]);
    expect(merge.store.accounts[0]?.label).toBe("Remote");
    expect(merge.store.accounts[0]?.addedAt).toBe(existing.addedAt);
    expect(merge.store.accounts[0]?.updatedAt).toBe(99);
  });

  it("generates a new id when a different imported account collides", () => {
    const existing = makeStoredAccount({
      id: "same-id",
      email: "one@example.com",
      accountId: "acct-1",
      principalId: "one@example.com"
    });
    const imported = makeStoredAccount({
      id: "same-id",
      email: "two@example.com",
      accountId: "acct-2",
      principalId: "two@example.com"
    });

    const merge = applyAccountsTransferMerge(
      [imported],
      new Set(["same-id"]),
      { version: 1, accounts: [existing] },
      99,
      { idGenerator: () => "generated-id" }
    );

    expect(merge.result.insertedCount).toBe(1);
    expect(merge.store.accounts[0]?.id).toBe("same-id");
    expect(merge.store.accounts[1]?.id).toBe("generated-id");
    expect(merge.store.accounts[1]?.email).toBe("two@example.com");
  });
});

describe("accounts coordinator", () => {
  it("imports current auth and updates an existing matching account", async () => {
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [
        makeStoredAccount({
          id: "local-1",
          accountId: "acct-1",
          email: "new@example.com",
          principalId: "old-principal",
          label: "Old"
        })
      ]
    });
    const authRepository = new FakeAuthRepository(fakeAuth("acct-1", "new@example.com", "plus", "new@example.com"));
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository,
      usageService: new FakeUsageService("pro"),
      dateProvider: fixedDateProvider()
    });

    const summary = await coordinator.importCurrentAuthAccount(" Updated ");

    expect(summary.id).toBe("local-1");
    expect(summary.label).toBe("Updated");
    expect(summary.planType).toBe("pro");
    expect(storeRepository.store.accounts).toHaveLength(1);
    expect(storeRepository.store.accounts[0]?.email).toBe("new@example.com");
    expect(storeRepository.store.accounts[0]?.principalId).toBe("new@example.com");
  });

  it("imports arbitrary auth JSON payloads into the account store", async () => {
    const storeRepository = new MemoryStoreRepository({ version: 1, accounts: [] });
    const authRepository = new FakeAuthRepository(undefined);
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository,
      usageService: new FakeUsageService("pro"),
      dateProvider: fixedDateProvider()
    });
    const authJson = fakeAuth("acct-file", "file@example.com", "plus", "file@example.com");

    const summary = await coordinator.importAccount(authJson, " File auth ");

    expect(summary.label).toBe("File auth");
    expect(summary.accountId).toBe("acct-file");
    expect(summary.email).toBe("file@example.com");
    expect(summary.planType).toBe("pro");
    expect(storeRepository.store.accounts).toHaveLength(1);
    expect(storeRepository.store.accounts[0]?.authJson).toEqual(authJson);
    expect(storeRepository.store.accounts[0]?.addedAt).toBe(1_780_000_000);
    expect(storeRepository.store.accounts[0]?.updatedAt).toBe(1_780_000_000);
  });

  it("switches accounts by recording selection and writing Codex auth", async () => {
    const accountA = makeStoredAccount({ id: "a", accountId: "acct-a", email: "a@example.com" });
    const accountB = makeStoredAccount({ id: "b", accountId: "acct-b", email: "b@example.com" });
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [accountA, accountB]
    });
    const authRepository = new FakeAuthRepository(undefined);
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository,
      dateProvider: fixedDateProvider()
    });

    await coordinator.switchAccount("b");

    expect(storeRepository.store.currentSelection).toEqual({
      accountId: "acct-b",
      selectedAt: 1_780_000_000_000,
      sourceDeviceID: "windows-local",
      accountKey: accountKeyForStoredAccount(accountB)
    });
    expect(authRepository.currentAuth).toEqual(accountB.authJson);
  });

  it("repairs stale Codex-visible auth by refreshing tokens before switching accounts", async () => {
    const staleAuth = fakeAuth("acct-b", "b@example.com", "team", "b@example.com", "free");
    const account = makeStoredAccount({
      id: "b",
      accountId: "acct-b",
      email: "b@example.com",
      authJson: staleAuth
    });
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [account]
    });
    const authRepository = new FakeAuthRepository(undefined);
    const refreshedTokens = fakeTokensForPlan("acct-b", "team", "refresh-new");
    const loginService = new FakeChatGPTLoginService(refreshedTokens);
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository,
      usageService: new FakeUsageService("team"),
      chatGPTOAuthLoginService: loginService,
      dateProvider: fixedDateProvider()
    });

    await coordinator.switchAccount("b");

    expect(loginService.refreshes).toEqual(["refresh-acct-b"]);
    expect(loginService.signIns).toEqual([]);
    expect(storeRepository.store.accounts[0]?.authJson).toMatchObject({
      accessToken: refreshedTokens.accessToken,
      refreshToken: refreshedTokens.refreshToken
    });
    expect(storeRepository.store.accounts[0]?.usage?.oneWeek?.usedPercent).toBe(20);
    expect(authRepository.currentAuth).toEqual(storeRepository.store.accounts[0]?.authJson);
  });

  it("falls back to interactive login when token refresh keeps a stale visible plan", async () => {
    const staleAuth = fakeAuth("acct-b", "b@example.com", "team", "b@example.com", "free");
    const account = makeStoredAccount({
      id: "b",
      accountId: "acct-b",
      email: "b@example.com",
      authJson: staleAuth
    });
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [account]
    });
    const authRepository = new FakeAuthRepository(undefined);
    const refreshedTokens = fakeTokensForPlan("acct-b", "free", "refresh-stale");
    const interactiveTokens = fakeTokensForPlan("acct-b", "team", "refresh-interactive");
    const loginService = new FakeChatGPTLoginService(interactiveTokens, refreshedTokens);
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository,
      chatGPTOAuthLoginService: loginService,
      dateProvider: fixedDateProvider()
    });

    await coordinator.switchAccount("b");

    expect(loginService.refreshes).toEqual(["refresh-acct-b"]);
    expect(loginService.signIns).toEqual([{ timeoutSeconds: 600, allowedWorkspaceId: "acct-b" }]);
    expect(storeRepository.store.accounts[0]?.authJson).toMatchObject({
      accessToken: interactiveTokens.accessToken,
      refreshToken: interactiveTokens.refreshToken
    });
    expect(authRepository.currentAuth).toEqual(storeRepository.store.accounts[0]?.authJson);
  });

  it("applies launch and editor restart side effects after switching accounts", async () => {
    const account = makeStoredAccount({ id: "b", accountId: "acct-b", email: "b@example.com" });
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [account]
    });
    const authRepository = new FakeAuthRepository(undefined);
    const settingsRepository = new FakeSettingsRepository({
      ...defaultAppSettings(),
      launchCodexAfterSwitch: true,
      restartEditorsOnSwitch: true,
      restartEditorTargets: ["cursor"]
    });
    let launchedWorkspacePath: string | undefined;
    let restartTargets: EditorAppID[] = [];
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository,
      settingsRepository,
      codexCLIService: {
        async launchApp(workspacePath?: string) {
          launchedWorkspacePath = workspacePath;
          return true;
        }
      } satisfies CodexCLIServiceLike,
      editorAppService: {
        async restartSelectedApps(targets: readonly EditorAppID[]) {
          restartTargets = [...targets];
          return { restarted: ["cursor"], error: "Cursor restart warning" };
        }
      } satisfies EditorAppServiceLike,
      dateProvider: fixedDateProvider()
    });

    const execution = await coordinator.switchAccountAndApplySettings("b", String.raw`C:\workspaces\demo`);

    expect(execution).toEqual({
      usedFallbackCLI: true,
      restartedEditorApps: ["cursor"],
      editorRestartError: "Cursor restart warning"
    });
    expect(launchedWorkspacePath).toBe(String.raw`C:\workspaces\demo`);
    expect(restartTargets).toEqual(["cursor"]);
    expect(authRepository.currentAuth).toEqual(account.authJson);
  });

  it("smart-switches through the current account when it is already best", async () => {
    const current = makeStoredAccount({
      id: "current",
      accountId: "acct-current",
      email: "current@example.com",
      usage: makeUsageSnapshot("team", 3, 5)
    });
    const other = makeStoredAccount({
      id: "other",
      accountId: "acct-other",
      email: "other@example.com",
      usage: makeUsageSnapshot("team", 60, 70)
    });
    const storeRepository = new MemoryStoreRepository({ version: 1, accounts: [current, other] });
    const authRepository = new FakeAuthRepository(current.authJson);
    const settingsRepository = new FakeSettingsRepository({
      ...defaultAppSettings(),
      launchCodexAfterSwitch: true,
      restartEditorsOnSwitch: true,
      restartEditorTargets: ["cursor"]
    });
    let launchedWorkspacePath: string | undefined = "not launched";
    let restartTargets: EditorAppID[] = [];
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository,
      settingsRepository,
      codexCLIService: {
        async launchApp(workspacePath?: string) {
          launchedWorkspacePath = workspacePath;
          return true;
        }
      } satisfies CodexCLIServiceLike,
      editorAppService: {
        async restartSelectedApps(targets: readonly EditorAppID[]) {
          restartTargets = [...targets];
          return { restarted: ["cursor"] };
        }
      } satisfies EditorAppServiceLike,
      dateProvider: fixedDateProvider()
    });

    const result = await coordinator.smartSwitch();

    expect(result?.account.id).toBe("current");
    expect(result?.execution).toEqual({ restartedEditorApps: ["cursor"], usedFallbackCLI: true });
    expect(launchedWorkspacePath).toBeUndefined();
    expect(restartTargets).toEqual(["cursor"]);
    expect(authRepository.currentAuth).toEqual(current.authJson);
    expect(storeRepository.store.currentSelection).toEqual({
      accountId: "acct-current",
      selectedAt: 1_780_000_000_000,
      sourceDeviceID: "windows-local",
      accountKey: accountKeyForStoredAccount(current)
    });
  });

  it("smart-switches to the highest remaining non-current account", async () => {
    const current = makeStoredAccount({
      id: "current",
      accountId: "acct-current",
      email: "current@example.com",
      usage: makeUsageSnapshot("team", 95, 90)
    });
    const best = makeStoredAccount({
      id: "best",
      accountId: "acct-best",
      email: "best@example.com",
      usage: makeUsageSnapshot("team", 5, 10)
    });
    const authRepository = new FakeAuthRepository(current.authJson);
    const coordinator = new AccountsCoordinator({
      storeRepository: new MemoryStoreRepository({ version: 1, accounts: [current, best] }),
      authRepository,
      dateProvider: fixedDateProvider()
    });

    const result = await coordinator.smartSwitch();

    expect(result?.account.id).toBe("best");
    expect(result?.execution).toEqual({ restartedEditorApps: [], usedFallbackCLI: false });
    expect(authRepository.currentAuth).toEqual(best.authJson);
  });

  it("enriches missing workspace names from remote metadata when listing accounts", async () => {
    const account = makeStoredAccount({
      id: "team",
      accountId: "acct-team",
      email: "team@example.com",
      teamName: undefined
    });
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [account]
    });
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository: new FakeAuthRepository(undefined),
      workspaceMetadataService: new FakeWorkspaceMetadataService([
        { accountId: "acct-team", workspaceName: "Workspace Alpha", structure: "workspace" }
      ]),
      dateProvider: fixedDateProvider()
    });

    const summaries = await coordinator.listAccounts();

    expect(summaries[0]?.teamName).toBe("Workspace Alpha");
    expect(storeRepository.store.accounts[0]?.teamName).toBe("Workspace Alpha");
  });

  it("warms fresh reset and expired exhausted weekly quota accounts", async () => {
    const fresh = makeStoredAccount({
      id: "fresh",
      accountId: "acct-fresh",
      usage: freshResetWeeklyUsage(1_780_000_001)
    });
    const expired = makeStoredAccount({
      id: "expired",
      accountId: "acct-expired",
      usage: exhaustedWeeklyUsage(1_779_999_999)
    });
    const futureExhausted = makeStoredAccount({
      id: "future-exhausted",
      accountId: "acct-future-exhausted",
      usage: exhaustedWeeklyUsage(1_780_000_001)
    });
    const partial = makeStoredAccount({
      id: "partial",
      accountId: "acct-partial",
      usage: partialWeeklyUsage(1_779_999_999)
    });
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [fresh, expired, futureExhausted, partial]
    });
    const warmupService = new FakeWeeklyQuotaWarmupService();
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository: new FakeAuthRepository(undefined),
      usageService: new FakeUsageService("team"),
      weeklyQuotaWarmupService: warmupService,
      dateProvider: fixedDateProvider()
    });

    const result = await coordinator.warmUpResetWeeklyQuotaAccounts();

    expect(result.targetCount).toBe(2);
    expect(result.succeededCount).toBe(2);
    expect(result.failures).toEqual([]);
    expect(warmupService.calls).toEqual([
      { accessToken: "access-acct-fresh", accountId: "acct-fresh" },
      { accessToken: "access-acct-expired", accountId: "acct-expired" }
    ]);
    expect(storeRepository.store.accounts.find((account) => account.id === "fresh")?.usage?.oneWeek?.usedPercent).toBe(20);
    expect(storeRepository.store.accounts.find((account) => account.id === "expired")?.usage?.oneWeek?.usedPercent).toBe(20);
  });

  it("stores weekly quota warmup failures on the account", async () => {
    const target = makeStoredAccount({
      id: "target",
      label: "Team",
      accountId: "acct-target",
      usage: exhaustedWeeklyUsage(1_779_999_999)
    });
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [target]
    });
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository: new FakeAuthRepository(undefined),
      usageService: new FakeUsageService("team"),
      weeklyQuotaWarmupService: new FakeWeeklyQuotaWarmupService(new Map([["acct-target", new Error("warmup failed")]])),
      dateProvider: fixedDateProvider()
    });

    const result = await coordinator.warmUpResetWeeklyQuotaAccounts();

    expect(result.succeededCount).toBe(0);
    expect(result.failures).toEqual([{ accountId: "target", label: "Team", message: "warmup failed" }]);
    expect(storeRepository.store.accounts[0]?.usageError).toBe("warmup failed");
  });

  it("throttles non-forced usage refreshes while keeping forced refreshes immediate", async () => {
    const freshUsage = {
      ...makeUsageSnapshot("team", 60, 70),
      fetchedAt: 1_779_999_980
    };
    const account = makeStoredAccount({
      id: "target",
      accountId: "acct-target",
      usage: freshUsage,
      updatedAt: 123
    });
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [account]
    });
    const usageService = new FakeUsageService("team");
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository: new FakeAuthRepository(undefined),
      usageService,
      dateProvider: fixedDateProvider()
    });

    await coordinator.refreshAllUsage({ force: false });

    expect(usageService.calls).toEqual([]);
    expect(storeRepository.store.accounts[0]?.usage).toEqual(freshUsage);
    expect(storeRepository.store.accounts[0]?.updatedAt).toBe(123);

    await coordinator.refreshAccountUsage("target");

    expect(usageService.calls).toEqual([{ accessToken: "access-acct-target", accountId: "acct-target" }]);
    expect(storeRepository.store.accounts[0]?.usage?.fiveHour?.usedPercent).toBe(10);
    expect(storeRepository.store.accounts[0]?.usage?.oneWeek?.usedPercent).toBe(20);
    expect(storeRepository.store.accounts[0]?.updatedAt).toBe(1_780_000_000);
  });

  it("refreshes stale usage snapshots during non-forced background refreshes", async () => {
    const staleUsage = {
      ...makeUsageSnapshot("team", 60, 70),
      fetchedAt: 1_779_999_975
    };
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [
        makeStoredAccount({
          id: "target",
          accountId: "acct-target",
          usage: staleUsage
        })
      ]
    });
    const usageService = new FakeUsageService("team");
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository: new FakeAuthRepository(undefined),
      usageService,
      dateProvider: fixedDateProvider()
    });

    await coordinator.refreshAllUsage({ force: false });

    expect(usageService.calls).toEqual([{ accessToken: "access-acct-target", accountId: "acct-target" }]);
    expect(storeRepository.store.accounts[0]?.usage?.fetchedAt).toBe(1_780_000_000);
    expect(storeRepository.store.accounts[0]?.usage?.fiveHour?.usedPercent).toBe(10);
    expect(storeRepository.store.accounts[0]?.usage?.oneWeek?.usedPercent).toBe(20);
  });

  it("refreshes ChatGPT tokens and retries usage after an unauthorized response", async () => {
    const account = makeStoredAccount({ id: "target", accountId: "acct-target" });
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [account]
    });
    const authRepository = new FakeAuthRepository(account.authJson);
    const usageService = new QueuedUsageService([
      new UnauthorizedError("unauthorized"),
      makeUsageSnapshot("team", 3, 4)
    ]);
    const loginService = new FakeChatGPTLoginService({
      accessToken: "access-refreshed",
      refreshToken: "refresh-new",
      idToken: "id-new"
    });
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository,
      usageService,
      chatGPTOAuthLoginService: loginService,
      dateProvider: fixedDateProvider()
    });

    await coordinator.refreshAccountUsage("target");

    expect(loginService.refreshes).toEqual(["refresh-acct-target"]);
    expect(usageService.calls.map((call) => call.accessToken)).toEqual(["access-acct-target", "access-refreshed"]);
    expect(storeRepository.store.accounts[0]?.authJson).toMatchObject({ accessToken: "access-refreshed" });
    expect(authRepository.currentAuth).toMatchObject({ accessToken: "access-refreshed" });
  });

  it("falls back to bounded interactive OAuth repair during manual single-account usage refresh", async () => {
    const account = makeStoredAccount({ id: "target", accountId: "acct-target" });
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [account]
    });
    const authRepository = new FakeAuthRepository(account.authJson);
    const usageService = new QueuedUsageService([
      new UnauthorizedError("unauthorized"),
      makeUsageSnapshot("team", 6, 7)
    ]);
    const loginService = new FakeChatGPTLoginService(
      {
        accessToken: "access-reauthorized",
        refreshToken: "refresh-reauthorized",
        idToken: "id-reauthorized"
      },
      new Error("refresh failed")
    );
    const coordinator = new AccountsCoordinator({
      storeRepository,
      authRepository,
      usageService,
      chatGPTOAuthLoginService: loginService,
      dateProvider: fixedDateProvider()
    });

    await coordinator.refreshAccountUsage("target", { allowInteractiveAuthRepair: true });

    expect(loginService.refreshes).toEqual(["refresh-acct-target"]);
    expect(loginService.signIns).toEqual([{ timeoutSeconds: 600, allowedWorkspaceId: "acct-target" }]);
    expect(usageService.calls.map((call) => call.accessToken)).toEqual(["access-acct-target", "access-reauthorized"]);
    expect(storeRepository.store.accounts[0]?.authJson).toMatchObject({ accessToken: "access-reauthorized" });
    expect(authRepository.currentAuth).toMatchObject({ accessToken: "access-reauthorized" });
  });
});

class MemoryStoreRepository implements AccountsStoreRepositoryLike {
  constructor(public store: AccountsStore) {}

  async loadStore(): Promise<AccountsStore> {
    return structuredClone(this.store);
  }

  async saveStore(store: AccountsStore): Promise<void> {
    this.store = structuredClone(store);
  }
}

class FakeSettingsRepository implements SettingsRepositoryLike {
  constructor(private readonly settings: AppSettings) {}

  async loadSettings(): Promise<AppSettings> {
    return structuredClone(this.settings);
  }
}

class FakeAuthRepository implements AuthRepositoryLike {
  public currentAuth: JSONValue | undefined;

  constructor(currentAuth: JSONValue | undefined) {
    this.currentAuth = currentAuth;
  }

  async readCurrentAuth(): Promise<JSONValue> {
    if (!this.currentAuth) {
      throw new Error("missing auth");
    }
    return this.currentAuth;
  }

  async readCurrentAuthOptional(): Promise<JSONValue | undefined> {
    return this.currentAuth;
  }

  async readAuth(): Promise<JSONValue> {
    if (!this.currentAuth) {
      throw new Error("missing auth");
    }
    return this.currentAuth;
  }

  async writeCurrentAuth(auth: JSONValue): Promise<void> {
    this.currentAuth = auth;
  }

  makeChatGPTAuth(tokens: ChatGPTOAuthTokens): JSONValue {
    return fakeAuth("acct-login", "login@example.com", "plus", tokens.idToken);
  }

  replacingChatGPTTokens(auth: JSONValue, tokens: ChatGPTOAuthTokens): JSONValue {
    const object = auth as Record<string, JSONValue>;
    const tokenObject = typeof object.tokens === "object" && object.tokens !== null && !Array.isArray(object.tokens)
      ? (object.tokens as Record<string, JSONValue>)
      : {};
    return {
      ...object,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokens: {
        ...tokenObject,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        id_token: tokens.idToken
      }
    };
  }

  extractAuth(auth: JSONValue): ExtractedAuth {
    const object = auth as Record<string, JSONValue>;
    return {
      accountId: String(object.accountId),
      accessToken: String(object.accessToken ?? "access-token"),
      email: typeof object.email === "string" ? object.email : undefined,
      planType: typeof object.planType === "string" ? object.planType : undefined,
      teamName: typeof object.teamName === "string" ? object.teamName : undefined,
      principalId: typeof object.principalId === "string" ? object.principalId : undefined
    };
  }
}

class FakeUsageService implements UsageServiceLike {
  public readonly calls: Array<{ accessToken: string; accountId: string }> = [];

  constructor(private readonly planType: string) {}

  async fetchUsage(accessToken: string, accountId: string): Promise<UsageSnapshot> {
    this.calls.push({ accessToken, accountId });
    return makeUsageSnapshot(this.planType, 10, 20);
  }
}

class QueuedUsageService implements UsageServiceLike {
  public readonly calls: Array<{ accessToken: string; accountId: string }> = [];

  constructor(private readonly results: Array<UsageSnapshot | Error>) {}

  async fetchUsage(accessToken: string, accountId: string): Promise<UsageSnapshot> {
    this.calls.push({ accessToken, accountId });
    const result = this.results.shift();
    if (!result) {
      throw new Error("missing queued usage result");
    }
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }
}

class FakeWeeklyQuotaWarmupService implements WeeklyQuotaWarmupServiceLike {
  public readonly calls: Array<{ accessToken: string; accountId: string }> = [];

  constructor(private readonly failuresByAccountId = new Map<string, Error>()) {}

  async warmUp(accessToken: string, accountId: string): Promise<void> {
    this.calls.push({ accessToken, accountId });
    const failure = this.failuresByAccountId.get(accountId);
    if (failure) {
      throw failure;
    }
  }
}

class FakeWorkspaceMetadataService implements WorkspaceMetadataServiceLike {
  constructor(private readonly metadata: WorkspaceMetadata[]) {}

  async fetchWorkspaceMetadata(): Promise<WorkspaceMetadata[]> {
    return structuredClone(this.metadata);
  }
}

class FakeChatGPTLoginService implements ChatGPTOAuthLoginServiceLike {
  public readonly refreshes: string[] = [];
  public readonly signIns: Array<{ timeoutSeconds: number; allowedWorkspaceId?: string }> = [];

  constructor(
    private readonly tokens: ChatGPTOAuthTokens,
    private readonly refreshOverride?: ChatGPTOAuthTokens | Error
  ) {}

  async signInWithChatGPT(timeoutSeconds: number, allowedWorkspaceId?: string): Promise<ChatGPTOAuthTokens> {
    this.signIns.push({ timeoutSeconds, allowedWorkspaceId });
    return this.tokens;
  }

  async refreshChatGPTTokens(refreshToken: string): Promise<ChatGPTOAuthTokens> {
    this.refreshes.push(refreshToken);
    if (this.refreshOverride instanceof Error) {
      throw this.refreshOverride;
    }
    if (this.refreshOverride) {
      return this.refreshOverride;
    }
    return this.tokens;
  }
}

function fixedDateProvider() {
  return {
    unixSecondsNow: () => 1_780_000_000,
    unixMillisecondsNow: () => 1_780_000_000_000
  };
}

function makeUsageSnapshot(planType: string, fiveHourUsed: number, oneWeekUsed: number): UsageSnapshot {
  return {
    fetchedAt: 1_780_000_000,
    planType,
    fiveHour: { usedPercent: fiveHourUsed, windowSeconds: 5 * 60 * 60 },
    oneWeek: { usedPercent: oneWeekUsed, windowSeconds: 7 * 24 * 60 * 60 }
  };
}

function makeUsageSnapshotWithReset(resetAt: number): UsageSnapshot {
  return {
    fetchedAt: 1_780_000_000,
    planType: "team",
    fiveHour: { usedPercent: 20, windowSeconds: 5 * 60 * 60, resetAt: resetAt + 1_000 },
    oneWeek: { usedPercent: 30, windowSeconds: 7 * 24 * 60 * 60, resetAt }
  };
}

function exhaustedWeeklyUsage(resetAt: number): UsageSnapshot {
  return weeklyUsage(100, resetAt);
}

function freshResetWeeklyUsage(resetAt: number): UsageSnapshot {
  return weeklyUsage(0, resetAt);
}

function partialWeeklyUsage(resetAt: number): UsageSnapshot {
  return weeklyUsage(50, resetAt);
}

function weeklyUsage(oneWeekUsedPercent: number, resetAt: number): UsageSnapshot {
  return {
    fetchedAt: 1_779_999_000,
    planType: "team",
    fiveHour: { usedPercent: 10, windowSeconds: 5 * 60 * 60, resetAt: 1_780_001_000 },
    oneWeek: { usedPercent: oneWeekUsedPercent, windowSeconds: 7 * 24 * 60 * 60, resetAt }
  };
}

function makeSummary(options: {
  id: string;
  weekUsed: number;
  hourUsed: number;
  isCurrent?: boolean;
}): AccountSummary {
  return {
    id: options.id,
    label: options.id,
    accountId: options.id,
    addedAt: 0,
    updatedAt: 0,
    usage: {
      fetchedAt: 0,
      fiveHour: { usedPercent: options.hourUsed, windowSeconds: 5 * 60 * 60 },
      oneWeek: { usedPercent: options.weekUsed, windowSeconds: 7 * 24 * 60 * 60 }
    },
    isCurrent: options.isCurrent ?? false,
    accountKey: `${options.id}|${options.id}`,
    effectivePlanType: "team",
    normalizedPlanLabel: "TEAM",
    shouldDisplayWorkspaceTag: false
  };
}

function makeStoredAccount(overrides: Partial<StoredAccount> = {}): StoredAccount {
  const accountId = overrides.accountId ?? "acct";
  const email = overrides.email ?? "user@example.com";
  return {
    id: "account",
    label: "Work",
    email,
    accountId,
    planType: "team",
    authJson: fakeAuth(accountId, email, "team", overrides.principalId ?? email),
    addedAt: 1,
    updatedAt: 2,
    principalId: email,
    ...overrides
  };
}

function fakeAuth(
  accountId: string,
  email: string,
  planType: string,
  principalId: string,
  visiblePlanType = planType
): JSONValue {
  return {
    accountId,
    accessToken: `access-${accountId}`,
    refreshToken: `refresh-${accountId}`,
    email,
    planType,
    principalId,
    tokens: {
      access_token: fakePlanJwt(visiblePlanType),
      refresh_token: `refresh-${accountId}`,
      id_token: fakePlanJwt(visiblePlanType)
    }
  };
}

function fakeTokensForPlan(accountId: string, planType: string, refreshToken: string): ChatGPTOAuthTokens {
  return {
    accessToken: fakePlanJwt(planType),
    refreshToken,
    idToken: fakePlanJwt(planType, { sub: accountId })
  };
}

function fakePlanJwt(planType: string, extraClaims: Record<string, JSONValue> = {}): string {
  return fakeJwt({
    ...extraClaims,
    "https://api.openai.com/auth": {
      chatgpt_plan_type: planType
    }
  });
}

function fakeJwt(payload: Record<string, JSONValue>): string {
  return `${base64UrlJson({ alg: "none", typ: "JWT" })}.${base64UrlJson(payload)}.`;
}

function base64UrlJson(value: Record<string, JSONValue>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
