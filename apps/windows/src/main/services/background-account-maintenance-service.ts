import type { AccountSummary } from "../../shared/models/accounts";
import type { AppSettings } from "../../shared/models/settings";

export interface BackgroundAccountMaintenanceAccountsLike {
  autoSmartSwitchIfNeeded(): Promise<unknown>;
  refreshAllUsage(options?: { force?: boolean }): Promise<AccountSummary[]>;
  refreshWorkspaceMetadata(forceRemoteCheck: boolean): Promise<AccountSummary[]>;
}

export interface BackgroundAccountMaintenanceSettingsLike {
  currentSettings(): Promise<AppSettings>;
}

export interface BackgroundMaintenanceScheduler {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, milliseconds: number): unknown;
}

export interface BackgroundAccountMaintenanceOptions {
  accountsCoordinator: BackgroundAccountMaintenanceAccountsLike;
  settingsCoordinator: BackgroundAccountMaintenanceSettingsLike;
  initialDelayMs?: number;
  intervalMs?: number;
  onAccountsUpdated?: (accounts: AccountSummary[]) => void;
  onError?: (error: unknown) => void;
  scheduler?: BackgroundMaintenanceScheduler;
}

const defaultInitialDelayMs = 700;
const defaultIntervalMs = 30_000;

export class BackgroundAccountMaintenanceService {
  private readonly accountsCoordinator: BackgroundAccountMaintenanceAccountsLike;
  private readonly settingsCoordinator: BackgroundAccountMaintenanceSettingsLike;
  private readonly scheduler: BackgroundMaintenanceScheduler;
  private readonly initialDelayMs: number;
  private readonly intervalMs: number;
  private readonly onAccountsUpdated: (accounts: AccountSummary[]) => void;
  private readonly onError: (error: unknown) => void;
  private isRunning = false;
  private isTicking = false;
  private timerHandle: unknown;

  constructor(options: BackgroundAccountMaintenanceOptions) {
    this.accountsCoordinator = options.accountsCoordinator;
    this.settingsCoordinator = options.settingsCoordinator;
    this.scheduler = options.scheduler ?? {
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds)
    };
    this.initialDelayMs = options.initialDelayMs ?? defaultInitialDelayMs;
    this.intervalMs = options.intervalMs ?? defaultIntervalMs;
    this.onAccountsUpdated = options.onAccountsUpdated ?? (() => undefined);
    this.onError = options.onError ?? (() => undefined);
  }

  start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.schedule(this.initialDelayMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timerHandle !== undefined) {
      this.scheduler.clearTimeout(this.timerHandle);
      this.timerHandle = undefined;
    }
  }

  async runNow(): Promise<void> {
    await this.runMaintenanceTick();
  }

  private schedule(milliseconds: number): void {
    this.timerHandle = this.scheduler.setTimeout(() => {
      void this.runScheduledTick();
    }, milliseconds);
  }

  private async runScheduledTick(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    await this.runMaintenanceTick();
    if (this.isRunning) {
      this.schedule(this.intervalMs);
    }
  }

  private async runMaintenanceTick(): Promise<void> {
    if (this.isTicking) {
      return;
    }

    this.isTicking = true;
    try {
      const settings = await this.settingsCoordinator.currentSettings();
      await this.accountsCoordinator.refreshAllUsage({ force: false });
      if (settings.autoSmartSwitch) {
        await this.accountsCoordinator.autoSmartSwitchIfNeeded();
      }
      const accounts = await this.accountsCoordinator.refreshWorkspaceMetadata(false);
      this.onAccountsUpdated(accounts);
    } catch (error) {
      this.onError(error);
    } finally {
      this.isTicking = false;
    }
  }
}
