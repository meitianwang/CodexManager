import { win32 } from "node:path";

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
  execPath?: string;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
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
    const platform = this.options.platform ?? process.platform;
    const isPackaged = this.options.isPackaged ?? false;
    if (platform !== "win32" || !isPackaged) {
      return undefined;
    }

    const execPath = this.options.execPath ?? process.execPath;
    const appDirectory = win32.dirname(execPath);
    if (!/^app-[^\\/]+$/i.test(win32.basename(appDirectory))) {
      return undefined;
    }

    return {
      path: win32.join(win32.dirname(appDirectory), "Update.exe"),
      args: ["--processStart", win32.basename(execPath)]
    };
  }
}
