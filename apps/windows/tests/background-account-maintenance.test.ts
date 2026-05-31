import { describe, expect, it } from "vitest";
import {
  BackgroundAccountMaintenanceService,
  type BackgroundAccountMaintenanceAccountsLike,
  type BackgroundMaintenanceScheduler
} from "../src/main/services/background-account-maintenance-service";
import type { AccountSummary } from "../src/shared/models/accounts";
import { defaultAppSettings, type AppSettings } from "../src/shared/models/settings";

describe("background account maintenance service", () => {
  it("schedules the first refresh after the mac-compatible startup delay", () => {
    const scheduler = new FakeScheduler();
    const service = makeService({ scheduler });

    service.start();
    service.start();

    expect(scheduler.scheduled.map((timer) => timer.milliseconds)).toEqual([700]);

    service.stop();

    expect(scheduler.clearedHandles).toEqual([1]);
  });

  it("refreshes usage, auto switches, refreshes workspace metadata, and publishes the final account list", async () => {
    const accounts = new FakeAccounts();
    accounts.accounts = [
      makeAccount("idle"),
      makeAccount("current", { isCurrent: true }),
      makeAccount("reset-soon", { oneWeekResetAt: fixedNow + 60 }),
      makeAccount("failed", { usageError: "refresh failed" }),
      makeAccount("reset-later", { oneWeekResetAt: fixedNow + 61 })
    ];
    const settings = new FakeSettings({ autoSmartSwitch: true });
    const updates: AccountSummary[][] = [];
    const service = makeService({
      accountsCoordinator: accounts,
      settingsCoordinator: settings,
      onAccountsUpdated: (nextAccounts) => updates.push(nextAccounts)
    });

    await service.runNow();

    expect(accounts.calls).toEqual([
      "listAccounts",
      "refreshUsage:current,reset-soon,failed:false",
      "autoSmartSwitchIfNeeded",
      "refreshWorkspaceMetadata:false"
    ]);
    expect(updates).toEqual([accounts.metadataResult]);
  });

  it("does not auto switch when the setting is disabled", async () => {
    const accounts = new FakeAccounts();
    const settings = new FakeSettings({ autoSmartSwitch: false });
    const service = makeService({
      accountsCoordinator: accounts,
      settingsCoordinator: settings
    });

    await service.runNow();

    expect(accounts.calls).toEqual(["listAccounts", "refreshUsage:current:false", "refreshWorkspaceMetadata:false"]);
  });

  it("skips usage refresh and auto switch when no account matches the mac background refresh plan", async () => {
    const accounts = new FakeAccounts();
    accounts.accounts = [makeAccount("idle")];
    const settings = new FakeSettings({ autoSmartSwitch: true });
    const service = makeService({
      accountsCoordinator: accounts,
      settingsCoordinator: settings
    });

    await service.runNow();

    expect(accounts.calls).toEqual(["listAccounts", "refreshWorkspaceMetadata:false"]);
  });

  it("reports refresh errors without publishing stale account data", async () => {
    const refreshError = new Error("refresh failed");
    const accounts = new FakeAccounts();
    accounts.refreshError = refreshError;
    const errors: unknown[] = [];
    const updates: AccountSummary[][] = [];
    const service = makeService({
      accountsCoordinator: accounts,
      onAccountsUpdated: (nextAccounts) => updates.push(nextAccounts),
      onError: (error) => errors.push(error)
    });

    await service.runNow();

    expect(errors).toEqual([refreshError]);
    expect(updates).toEqual([]);
  });

  it("skips overlapping refresh cycles", async () => {
    const accounts = new FakeAccounts();
    let releaseRefresh: ((accounts: AccountSummary[]) => void) | undefined;
    accounts.refreshUsageHandler = () =>
      new Promise<AccountSummary[]>((resolve) => {
        releaseRefresh = resolve;
      });
    const service = makeService({ accountsCoordinator: accounts });

    const firstRun = service.runNow();
    const secondRun = service.runNow();
    await secondRun;
    await Promise.resolve();

    expect(accounts.calls).toEqual(["listAccounts", "refreshUsage:current:false"]);
    expect(releaseRefresh).toBeDefined();

    releaseRefresh?.([makeAccount("usage")]);
    await firstRun;
  });
});

function makeService(
  options: Partial<ConstructorParameters<typeof BackgroundAccountMaintenanceService>[0]> = {}
): BackgroundAccountMaintenanceService {
  return new BackgroundAccountMaintenanceService({
    accountsCoordinator: new FakeAccounts(),
    dateProvider: fixedDateProvider(),
    settingsCoordinator: new FakeSettings(),
    ...options
  });
}

const fixedNow = 1_780_000_000;

class FakeAccounts implements BackgroundAccountMaintenanceAccountsLike {
  calls: string[] = [];
  accounts = [makeAccount("current", { isCurrent: true })];
  metadataResult = [makeAccount("metadata")];
  refreshError: Error | undefined;
  refreshUsageHandler: (() => Promise<AccountSummary[]>) | undefined;

  async listAccounts(): Promise<AccountSummary[]> {
    this.calls.push("listAccounts");
    return this.accounts;
  }

  async refreshUsage(accountIds: readonly string[], options: { force?: boolean } = {}): Promise<AccountSummary[]> {
    this.calls.push(`refreshUsage:${accountIds.join(",")}:${String(options.force)}`);
    if (this.refreshError) {
      throw this.refreshError;
    }
    if (this.refreshUsageHandler) {
      return this.refreshUsageHandler();
    }
    return this.accounts;
  }

  async autoSmartSwitchIfNeeded(): Promise<unknown> {
    this.calls.push("autoSmartSwitchIfNeeded");
    return { switched: true };
  }

  async refreshWorkspaceMetadata(forceRemoteCheck: boolean): Promise<AccountSummary[]> {
    this.calls.push(`refreshWorkspaceMetadata:${String(forceRemoteCheck)}`);
    return this.metadataResult;
  }
}

function fixedDateProvider() {
  return {
    unixSecondsNow: () => fixedNow
  };
}

class FakeSettings {
  private readonly settings: AppSettings;

  constructor(patch: Partial<AppSettings> = {}) {
    this.settings = { ...defaultAppSettings(), ...patch };
  }

  async currentSettings(): Promise<AppSettings> {
    return this.settings;
  }
}

class FakeScheduler implements BackgroundMaintenanceScheduler {
  scheduled: Array<{ callback: () => void; handle: number; milliseconds: number }> = [];
  clearedHandles: unknown[] = [];
  private nextHandle = 1;

  setTimeout(callback: () => void, milliseconds: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.scheduled.push({ callback, handle, milliseconds });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.clearedHandles.push(handle);
    this.scheduled = this.scheduled.filter((timer) => timer.handle !== handle);
  }
}

function makeAccount(
  id: string,
  options: {
    isCurrent?: boolean;
    oneWeekResetAt?: number;
    usageError?: string;
  } = {}
): AccountSummary {
  const usage = options.oneWeekResetAt === undefined
    ? undefined
    : {
        fetchedAt: fixedNow - 100,
        oneWeek: { resetAt: options.oneWeekResetAt, usedPercent: 95, windowSeconds: 7 * 24 * 60 * 60 }
      };
  return {
    id,
    accountId: `acct-${id}`,
    accountKey: `key-${id}`,
    addedAt: 1,
    displayTeamName: "Team",
    effectivePlanType: "pro",
    isCurrent: options.isCurrent ?? false,
    label: id,
    normalizedPlanLabel: "Pro",
    shouldDisplayWorkspaceTag: true,
    updatedAt: 2,
    usage,
    usageError: options.usageError
  };
}
