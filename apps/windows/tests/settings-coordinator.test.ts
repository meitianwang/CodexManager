import { describe, expect, it } from "vitest";
import type { AppSettings } from "../src/shared/models/settings";
import { defaultAppSettings } from "../src/shared/models/settings";
import { SettingsCoordinator, type LaunchAtStartupServiceLike, type SettingsRepositoryLike } from "../src/main/services/settings-coordinator";

describe("settings coordinator", () => {
  it("persists patches and syncs launch-at-startup changes", async () => {
    const repository = new MemorySettingsRepository(defaultAppSettings());
    const launchAtStartup = new RecordingLaunchAtStartupService();
    const coordinator = new SettingsCoordinator(repository, launchAtStartup);

    const settings = await coordinator.updateSettings({
      launchAtStartup: true,
      locale: "zh-TW",
      proxyPort: 19191,
      restartEditorTargets: ["cursor"]
    });

    expect(settings.launchAtStartup).toBe(true);
    expect(settings.locale).toBe("zh-Hant");
    expect(settings.proxyPort).toBe(19191);
    expect(settings.restartEditorTargets).toEqual(["cursor"]);
    expect(repository.settings).toEqual(settings);
    expect(launchAtStartup.enabledValues).toEqual([true]);
  });
});

class MemorySettingsRepository implements SettingsRepositoryLike {
  constructor(public settings: AppSettings) {}

  async loadSettings(): Promise<AppSettings> {
    return structuredClone(this.settings);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.settings = structuredClone(settings);
  }
}

class RecordingLaunchAtStartupService implements LaunchAtStartupServiceLike {
  public enabledValues: boolean[] = [];

  setEnabled(enabled: boolean): void {
    this.enabledValues.push(enabled);
  }

  syncWithStoreValue(): void {
    return undefined;
  }
}
