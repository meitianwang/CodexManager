import type { AppSettings } from "../../shared/models/settings";
import { generateProxyApiKey } from "../../shared/models/settings";
import type { ProxyRuntimeState } from "../../shared/models/proxy";
import { proxyAvailableModels } from "../../shared/models/proxy";
import type { ProxyCoordinator } from "../proxy/proxy-coordinator";
import type { SettingsCoordinator } from "./settings-coordinator";

export interface RemoteModelCatalogServiceLike {
  cachedAvailableModels(): string[] | undefined;
  refreshModels(): Promise<string[] | undefined>;
}

export interface ProxyRuntimeServiceOptions {
  modelCatalogService?: RemoteModelCatalogServiceLike;
}

export class ProxyRuntimeService {
  private isRunning = false;
  private runningPort: number | undefined;
  private availableModels: string[] = [...proxyAvailableModels];
  private readonly modelCatalogService: RemoteModelCatalogServiceLike | undefined;

  constructor(
    private readonly proxyCoordinator: ProxyCoordinator,
    private readonly settingsCoordinator: SettingsCoordinator,
    options: ProxyRuntimeServiceOptions = {}
  ) {
    this.modelCatalogService = options.modelCatalogService;
    this.availableModels = options.modelCatalogService?.cachedAvailableModels() ?? [...proxyAvailableModels];
  }

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
    this.availableModels = await this.refreshAvailableModels();
    return this.stateFromSettings({ ...settings, proxyPort: this.runningPort });
  }

  async stop(): Promise<ProxyRuntimeState> {
    await this.proxyCoordinator.stop();
    this.isRunning = false;
    this.runningPort = undefined;
    this.availableModels = [...proxyAvailableModels];
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

  private async refreshAvailableModels(): Promise<string[]> {
    if (!this.modelCatalogService) {
      return [...proxyAvailableModels];
    }
    try {
      const models = await this.modelCatalogService.refreshModels();
      return models && models.length > 0 ? models : [...proxyAvailableModels];
    } catch (error) {
      console.warn("Failed to refresh remote model catalog", error);
      return [...proxyAvailableModels];
    }
  }

  private stateFromSettings(settings: AppSettings): ProxyRuntimeState {
    const port = this.runningPort ?? settings.proxyPort;
    return {
      apiKey: settings.proxyApiKey,
      availableModels: [...this.availableModels],
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
