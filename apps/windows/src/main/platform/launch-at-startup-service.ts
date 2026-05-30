export interface LoginItemSettings {
  openAtLogin: boolean;
}

export interface LoginItemAdapter {
  getLoginItemSettings(): LoginItemSettings;
  setLoginItemSettings(settings: LoginItemSettings): void;
}

export class LaunchAtStartupService {
  constructor(private readonly adapter: LoginItemAdapter) {}

  setEnabled(enabled: boolean): void {
    this.adapter.setLoginItemSettings({ openAtLogin: enabled });
  }

  syncWithStoreValue(enabled: boolean): void {
    const currentlyEnabled = this.adapter.getLoginItemSettings().openAtLogin;
    if (currentlyEnabled === enabled) {
      return;
    }
    this.setEnabled(enabled);
  }
}
