import type { AppSettings } from "../../shared/models/settings";
import { generateProxyApiKey } from "../../shared/models/settings";
import type { ProxyRuntimeState } from "../../shared/models/proxy";
import { proxyAvailableModels } from "../../shared/models/proxy";
import type { ProxyCoordinator } from "../proxy/proxy-coordinator";
import type { SettingsCoordinator } from "./settings-coordinator";

export class ProxyRuntimeService {
  private isRunning = false;
  private runningPort: number | undefined;

  constructor(
    private readonly proxyCoordinator: ProxyCoordinator,
    private readonly settingsCoordinator: SettingsCoordinator
  ) {}

  async getState(): Promise<ProxyRuntimeState> {
    const settings = await this.settingsWithApiKey();
    return this.stateFromSettings(settings);
  }

  async start(port: number, apiKey?: string): Promise<ProxyRuntimeState> {
    const settings = await this.settingsCoordinator.updateSettings({
      proxyPort: port,
      proxyApiKey: normalizeApiKey(apiKey) ?? generateProxyApiKey()
    });
    this.runningPort = await this.proxyCoordinator.start(settings.proxyPort);
    this.isRunning = true;
    return this.stateFromSettings({ ...settings, proxyPort: this.runningPort });
  }

  async stop(): Promise<ProxyRuntimeState> {
    await this.proxyCoordinator.stop();
    this.isRunning = false;
    this.runningPort = undefined;
    return this.getState();
  }

  async regenerateApiKey(): Promise<ProxyRuntimeState> {
    const settings = await this.settingsCoordinator.updateSettings({
      proxyApiKey: generateProxyApiKey()
    });
    return this.stateFromSettings(settings);
  }

  private async settingsWithApiKey(): Promise<AppSettings> {
    const settings = await this.settingsCoordinator.currentSettings();
    if (settings.proxyApiKey) {
      return settings;
    }
    return this.settingsCoordinator.updateSettings({ proxyApiKey: generateProxyApiKey() });
  }

  private stateFromSettings(settings: AppSettings): ProxyRuntimeState {
    const port = this.runningPort ?? settings.proxyPort;
    return {
      apiKey: settings.proxyApiKey,
      availableModels: [...proxyAvailableModels],
      isRunning: this.isRunning,
      port,
      proxyURL: `http://localhost:${port}`
    };
  }
}

function normalizeApiKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
