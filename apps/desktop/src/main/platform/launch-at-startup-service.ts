export interface LoginItemSettings {
  openAtLogin: boolean;
  args?: string[];
  enabled?: boolean;
  path?: string;
}

export interface LoginItemSettingsOptions {
  args?: string[];
  path?: string;
}

export interface LoginItemAdapter {
  getLoginItemSettings(options?: LoginItemSettingsOptions): LoginItemSettings;
  setLoginItemSettings(settings: LoginItemSettings): void;
}

export interface LaunchAtStartupServiceOptions {
  loginItemTarget?: LoginItemSettingsOptions | (() => LoginItemSettingsOptions | undefined);
}

export class LaunchAtStartupService {
  constructor(
    private readonly adapter: LoginItemAdapter,
    private readonly options: LaunchAtStartupServiceOptions = {}
  ) {}

  setEnabled(enabled: boolean): void {
    this.adapter.setLoginItemSettings(this.loginItemSettings(enabled));
  }

  syncWithStoreValue(enabled: boolean): void {
    const currentlyEnabled = this.adapter.getLoginItemSettings(this.loginItemTarget()).openAtLogin;
    if (currentlyEnabled === enabled) {
      return;
    }
    this.setEnabled(enabled);
  }

  private loginItemSettings(enabled: boolean): LoginItemSettings {
    const target = this.loginItemTarget();
    return target ? { openAtLogin: enabled, enabled, ...target } : { openAtLogin: enabled };
  }

  private loginItemTarget(): LoginItemSettingsOptions | undefined {
    return typeof this.options.loginItemTarget === "function"
      ? this.options.loginItemTarget()
      : this.options.loginItemTarget;
  }
}
