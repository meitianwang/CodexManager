import type { AppSettings, AppSettingsPatch } from "../../shared/models/settings";
import { normalizeEditorAppIDs, resolveAppLocale } from "../../shared/models/settings";

export interface SettingsRepositoryLike {
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
}

export interface LaunchAtStartupServiceLike {
  setEnabled(enabled: boolean): void | Promise<void>;
  syncWithStoreValue(enabled: boolean): void | Promise<void>;
}

export class SettingsCoordinator {
  constructor(
    private readonly settingsRepository: SettingsRepositoryLike,
    private readonly launchAtStartupService: LaunchAtStartupServiceLike
  ) {}

  async currentSettings(): Promise<AppSettings> {
    return this.settingsRepository.loadSettings();
  }

  async updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    const launchAtStartupPatch = patch.launchAtStartup;
    const settings = await this.settingsRepository.loadSettings();

    if (patch.launchAtStartup !== undefined) {
      settings.launchAtStartup = patch.launchAtStartup;
    }
    if (patch.launchCodexAfterSwitch !== undefined) {
      settings.launchCodexAfterSwitch = patch.launchCodexAfterSwitch;
    }
    if (patch.autoSmartSwitch !== undefined) {
      settings.autoSmartSwitch = patch.autoSmartSwitch;
    }
    if (patch.restartEditorsOnSwitch !== undefined) {
      settings.restartEditorsOnSwitch = patch.restartEditorsOnSwitch;
    }
    if (patch.restartEditorTargets !== undefined) {
      settings.restartEditorTargets = normalizeEditorAppIDs(patch.restartEditorTargets);
    }
    if (patch.locale !== undefined) {
      settings.locale = resolveAppLocale(patch.locale);
    }
    if (patch.proxyPort !== undefined) {
      settings.proxyPort = patch.proxyPort;
    }
    if (patch.proxyApiKey !== undefined) {
      settings.proxyApiKey = patch.proxyApiKey;
    }
    if (patch.autoStartProxy !== undefined) {
      settings.autoStartProxy = patch.autoStartProxy;
    }

    await this.settingsRepository.saveSettings(settings);
    if (launchAtStartupPatch !== undefined) {
      await this.launchAtStartupService.setEnabled(launchAtStartupPatch);
    }
    return settings;
  }

  async syncLaunchAtStartupFromStore(): Promise<void> {
    const settings = await this.settingsRepository.loadSettings();
    await this.launchAtStartupService.syncWithStoreValue(settings.launchAtStartup);
  }
}
