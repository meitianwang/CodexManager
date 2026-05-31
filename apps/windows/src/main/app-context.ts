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
import type { ChatGPTOAuthTokens } from "../shared/models/auth";
import type { EditorAppID } from "../shared/models/settings";

export interface SmokePlatformSideEffectLog {
  codexLaunches: Array<{
    workspacePath?: string;
  }>;
  editorRestarts: Array<{
    restarted: EditorAppID[];
    targets: EditorAppID[];
  }>;
  oauthSignIns: Array<{
    accountId: string;
    allowedWorkspaceId?: string;
    timeoutSeconds: number;
  }>;
  startupSetEnabledValues: boolean[];
  startupSyncValues: boolean[];
}

export interface SmokePlatformSideEffects {
  snapshot(): SmokePlatformSideEffectLog;
}

export interface WindowsAppContext {
  accountsCoordinator: AccountsCoordinator;
  authRepository: AuthFileRepository;
  editorAppService: EditorAppService;
  paths: FileSystemPaths;
  proxyRuntimeService: ProxyRuntimeService;
  smokePlatformSideEffects?: SmokePlatformSideEffects;
  storeRepository: AccountsStoreRepository;
  settingsCoordinator: SettingsCoordinator;
}

export async function createWindowsAppContext(electronApp: App): Promise<WindowsAppContext> {
  const paths = resolveRuntimeFileSystemPaths(electronApp);
  const storeRepository = new AccountsStoreRepository(paths);
  const settingsRepository = new SettingsFileRepository(paths);
  const authRepository = new AuthFileRepository(paths);
  const smokePlatformSideEffects = createSmokePlatformSideEffects();
  const settingsCoordinator = new SettingsCoordinator(
    settingsRepository,
    smokePlatformSideEffects?.launchAtStartupService ??
      new LaunchAtStartupService(electronApp, { isPackaged: electronApp.isPackaged })
  );
  const usageService = new DefaultUsageService(paths);
  const weeklyQuotaWarmupService = new DefaultWeeklyQuotaWarmupService(paths);
  const workspaceMetadataService = new DefaultWorkspaceMetadataService(paths);
  const chatGPTOAuthLoginService =
    smokePlatformSideEffects?.chatGPTOAuthLoginService ??
    new OpenAIChatGPTOAuthLoginService(paths, {
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
    codexCLIService: smokePlatformSideEffects?.codexCLIService ?? new CodexCLIService(),
    editorAppService: smokePlatformSideEffects?.editorAppService ?? editorAppService
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
    smokePlatformSideEffects,
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

function createSmokePlatformSideEffects():
  | (SmokePlatformSideEffects & {
      codexCLIService: { launchApp(workspacePath?: string): Promise<boolean> };
      editorAppService: {
        restartSelectedApps(targets: readonly EditorAppID[]): Promise<{ restarted: EditorAppID[] }>;
      };
      chatGPTOAuthLoginService: {
        refreshChatGPTTokens(refreshToken: string): Promise<ChatGPTOAuthTokens>;
        signInWithChatGPT(timeoutSeconds: number, allowedWorkspaceId?: string): Promise<ChatGPTOAuthTokens>;
      };
      launchAtStartupService: {
        setEnabled(enabled: boolean): void;
        syncWithStoreValue(enabled: boolean): void;
      };
    })
  | undefined {
  if (!process.env.CODEX_MANAGER_ELECTRON_SMOKE_ROOT) {
    return undefined;
  }

  const log: SmokePlatformSideEffectLog = {
    codexLaunches: [],
    editorRestarts: [],
    oauthSignIns: [],
    startupSetEnabledValues: [],
    startupSyncValues: []
  };

  return {
    codexCLIService: {
      async launchApp(workspacePath?: string): Promise<boolean> {
        log.codexLaunches.push(workspacePath === undefined ? {} : { workspacePath });
        return true;
      }
    },
    editorAppService: {
      async restartSelectedApps(targets: readonly EditorAppID[]): Promise<{ restarted: EditorAppID[] }> {
        const normalizedTargets = [...targets];
        log.editorRestarts.push({
          restarted: normalizedTargets,
          targets: normalizedTargets
        });
        return { restarted: normalizedTargets };
      }
    },
    chatGPTOAuthLoginService: {
      async refreshChatGPTTokens(refreshToken: string): Promise<ChatGPTOAuthTokens> {
        return makeSmokeChatGPTOAuthTokens(refreshToken.replace(/^refresh-/, "") || "acct-oauth");
      },
      async signInWithChatGPT(timeoutSeconds: number, allowedWorkspaceId?: string): Promise<ChatGPTOAuthTokens> {
        const accountId = allowedWorkspaceId ?? "acct-oauth";
        log.oauthSignIns.push(
          allowedWorkspaceId === undefined
            ? { accountId, timeoutSeconds }
            : { accountId, allowedWorkspaceId, timeoutSeconds }
        );
        return makeSmokeChatGPTOAuthTokens(accountId);
      }
    },
    launchAtStartupService: {
      setEnabled(enabled: boolean): void {
        log.startupSetEnabledValues.push(enabled);
      },
      syncWithStoreValue(enabled: boolean): void {
        log.startupSyncValues.push(enabled);
      }
    },
    snapshot(): SmokePlatformSideEffectLog {
      return {
        codexLaunches: log.codexLaunches.map((entry) => ({ ...entry })),
        editorRestarts: log.editorRestarts.map((entry) => ({
          restarted: [...entry.restarted],
          targets: [...entry.targets]
        })),
        oauthSignIns: log.oauthSignIns.map((entry) => ({ ...entry })),
        startupSetEnabledValues: [...log.startupSetEnabledValues],
        startupSyncValues: [...log.startupSyncValues]
      };
    }
  };
}

function makeSmokeChatGPTOAuthTokens(accountId: string): ChatGPTOAuthTokens {
  return {
    accessToken: `access-${accountId}`,
    refreshToken: `refresh-${accountId}`,
    idToken: makeSmokeJwt({
      email: `${accountId}@example.com`,
      sub: `${accountId}@example.com`,
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
        chatgpt_plan_type: "plus",
        chatgpt_team_name: "Smoke OAuth Team"
      }
    })
  };
}

function makeSmokeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}
