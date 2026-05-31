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
    const settings = new FakeSettings({ autoSmartSwitch: true });
    const updates: AccountSummary[][] = [];
    const service = makeService({
      accountsCoordinator: accounts,
      settingsCoordinator: settings,
      onAccountsUpdated: (nextAccounts) => updates.push(nextAccounts)
    });

    await service.runNow();

    expect(accounts.calls).toEqual(["refreshAllUsage:false", "autoSmartSwitchIfNeeded", "refreshWorkspaceMetadata:false"]);
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

    expect(accounts.calls).toEqual(["refreshAllUsage:false", "refreshWorkspaceMetadata:false"]);
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
    accounts.refreshAllUsageHandler = () =>
      new Promise<AccountSummary[]>((resolve) => {
        releaseRefresh = resolve;
      });
    const service = makeService({ accountsCoordinator: accounts });

    const firstRun = service.runNow();
    const secondRun = service.runNow();
    await secondRun;
    await Promise.resolve();

    expect(accounts.calls).toEqual(["refreshAllUsage:false"]);
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
    settingsCoordinator: new FakeSettings(),
    ...options
  });
}

class FakeAccounts implements BackgroundAccountMaintenanceAccountsLike {
  calls: string[] = [];
  metadataResult = [makeAccount("metadata")];
  refreshError: Error | undefined;
  refreshAllUsageHandler: (() => Promise<AccountSummary[]>) | undefined;

  async refreshAllUsage(options: { force?: boolean } = {}): Promise<AccountSummary[]> {
    this.calls.push(`refreshAllUsage:${String(options.force)}`);
    if (this.refreshError) {
      throw this.refreshError;
    }
    if (this.refreshAllUsageHandler) {
      return this.refreshAllUsageHandler();
    }
    return [makeAccount("usage")];
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

function makeAccount(id: string): AccountSummary {
  return {
    id,
    accountId: `acct-${id}`,
    accountKey: `key-${id}`,
    addedAt: 1,
    displayTeamName: "Team",
    effectivePlanType: "pro",
    isCurrent: false,
    label: id,
    normalizedPlanLabel: "Pro",
    shouldDisplayWorkspaceTag: true,
    updatedAt: 2
  };
}
