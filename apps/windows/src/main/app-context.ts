import { join } from "node:path";
import type { App } from "electron";
import { AccountsStoreRepository } from "./repositories/accounts-store-repository";
import { AuthFileRepository } from "./repositories/auth-repository";
import { resolveWindowsFileSystemPaths, type FileSystemPaths } from "./repositories/file-system-paths";
import { SettingsFileRepository } from "./repositories/settings-repository";
import { ProxyCoordinator } from "./proxy/proxy-coordinator";
import { AccountsCoordinator } from "./services/accounts-coordinator";
import { OpenAIChatGPTOAuthLoginService } from "./services/oauth/openai-chatgpt-oauth-service";
import { ProxyRuntimeService } from "./services/proxy-runtime-service";
import { SettingsCoordinator } from "./services/settings-coordinator";
import { DefaultUsageService } from "./services/usage-service";
import { DefaultWeeklyQuotaWarmupService } from "./services/weekly-quota-warmup-service";
import { DefaultWorkspaceMetadataService } from "./services/workspace-metadata-service";
import { RemoteModelCatalogService } from "./services/remote-model-catalog-service";
import { CodexCLIService } from "./platform/codex-cli-service";
import { EditorAppService } from "./platform/editor-app-service";
import { LaunchAtStartupService } from "./platform/launch-at-startup-service";

export interface WindowsAppContext {
  accountsCoordinator: AccountsCoordinator;
  authRepository: AuthFileRepository;
  editorAppService: EditorAppService;
  paths: FileSystemPaths;
  proxyRuntimeService: ProxyRuntimeService;
  storeRepository: AccountsStoreRepository;
  settingsCoordinator: SettingsCoordinator;
}

export async function createWindowsAppContext(electronApp: App): Promise<WindowsAppContext> {
  const paths = resolveRuntimeFileSystemPaths(electronApp);
  const storeRepository = new AccountsStoreRepository(paths);
  const settingsRepository = new SettingsFileRepository(paths);
  const authRepository = new AuthFileRepository(paths);
  const settingsCoordinator = new SettingsCoordinator(
    settingsRepository,
    new LaunchAtStartupService(electronApp)
  );
  const usageService = new DefaultUsageService(paths);
  const weeklyQuotaWarmupService = new DefaultWeeklyQuotaWarmupService(paths);
  const workspaceMetadataService = new DefaultWorkspaceMetadataService(paths);
  const chatGPTOAuthLoginService = new OpenAIChatGPTOAuthLoginService(paths, {
    localeProvider: async () => (await settingsRepository.loadSettings()).locale
  });
  const editorAppService = new EditorAppService();
  const remoteModelCatalogService = new RemoteModelCatalogService({ storeRepository });
  const accountsCoordinator = new AccountsCoordinator({
    storeRepository,
    settingsRepository,
    authRepository,
    usageService,
    weeklyQuotaWarmupService,
    workspaceMetadataService,
    chatGPTOAuthLoginService,
    codexCLIService: new CodexCLIService(),
    editorAppService
  });
  const proxyRuntimeService = new ProxyRuntimeService(
    new ProxyCoordinator({
      storeRepository,
      settingsRepository,
      authRepository,
      codexConfigPath: paths.codexConfigPath,
      chatGPTOAuthLoginService,
      modelCatalogService: remoteModelCatalogService
    }),
    settingsCoordinator,
    { modelCatalogService: remoteModelCatalogService }
  );

  await settingsCoordinator.syncLaunchAtStartupFromStore();
  const settings = await settingsCoordinator.currentSettings();
  if (settings.autoStartProxy) {
    try {
      await proxyRuntimeService.start(settings.proxyPort, settings.proxyApiKey);
    } catch (error) {
      console.error("Failed to auto-start proxy", error);
    }
  }

  return {
    accountsCoordinator,
    authRepository,
    editorAppService,
    paths,
    proxyRuntimeService,
    storeRepository,
    settingsCoordinator
  };
}

function resolveRuntimeFileSystemPaths(electronApp: Pick<App, "getPath">): FileSystemPaths {
  const smokeRoot = process.env.CODEX_MANAGER_ELECTRON_SMOKE_ROOT;
  if (smokeRoot) {
    const applicationSupportDirectory = join(smokeRoot, "app-data", "CodexManager");
    const codexDirectory = join(smokeRoot, "user", ".codex");
    return {
      applicationSupportDirectory,
      accountStorePath: join(applicationSupportDirectory, "accounts.json"),
      settingsStorePath: join(applicationSupportDirectory, "settings.json"),
      codexAuthPath: join(codexDirectory, "auth.json"),
      codexConfigPath: join(codexDirectory, "config.toml")
    };
  }

  if (process.platform === "win32") {
    return resolveWindowsFileSystemPaths(process.env);
  }

  const applicationSupportDirectory = electronApp.getPath("userData");
  const codexDirectory = join(electronApp.getPath("home"), ".codex");
  return {
    applicationSupportDirectory,
    accountStorePath: join(applicationSupportDirectory, "accounts.json"),
    settingsStorePath: join(applicationSupportDirectory, "settings.json"),
    codexAuthPath: join(codexDirectory, "auth.json"),
    codexConfigPath: join(codexDirectory, "config.toml")
  };
}
