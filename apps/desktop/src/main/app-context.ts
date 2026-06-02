import type { App } from "electron";
import { AccountsStoreRepository } from "./repositories/accounts-store-repository";
import { AuthFileRepository } from "./repositories/auth-repository";
import type { FileSystemPaths } from "./repositories/file-system-paths";
import { SettingsFileRepository } from "./repositories/settings-repository";
import { ProxyCoordinator } from "./proxy/proxy-coordinator";
import {
  CodexUpstreamClient,
  type CodexUpstreamClientLike,
  type CodexUpstreamRequest,
  type CodexUpstreamResult
} from "./proxy/upstream-client";
import { AccountsCoordinator } from "./services/accounts-coordinator";
import { OpenAIChatGPTOAuthLoginService } from "./services/oauth/openai-chatgpt-oauth-service";
import { ProxyRuntimeService } from "./services/proxy-runtime-service";
import { SettingsCoordinator } from "./services/settings-coordinator";
import { DefaultUsageService } from "./services/usage-service";
import { DefaultWeeklyQuotaWarmupService } from "./services/weekly-quota-warmup-service";
import { DefaultWorkspaceMetadataService } from "./services/workspace-metadata-service";
import { RemoteModelCatalogService } from "./services/remote-model-catalog-service";
import { createDesktopPlatform } from "./platform";
import type { DesktopPlatform, EditorAppServiceLike } from "./platform/types";
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
  proxyUpstreamRequests: Array<{
    accountId: string;
    bodyLength: number;
    isStream: boolean;
    method: string;
    normalizedPath: string;
  }>;
  startupSetEnabledValues: boolean[];
  startupSyncValues: boolean[];
}

export interface SmokePlatformSideEffects {
  snapshot(): SmokePlatformSideEffectLog;
}

export interface DesktopAppContext {
  accountsCoordinator: AccountsCoordinator;
  authRepository: AuthFileRepository;
  editorAppService: EditorAppServiceLike;
  paths: FileSystemPaths;
  platform: DesktopPlatform;
  proxyRuntimeService: ProxyRuntimeService;
  smokePlatformSideEffects?: SmokePlatformSideEffects;
  storeRepository: AccountsStoreRepository;
  settingsCoordinator: SettingsCoordinator;
}

export interface CreateDesktopAppContextOptions {
  platform?: DesktopPlatform;
}

export async function createDesktopAppContext(
  electronApp: App,
  options: CreateDesktopAppContextOptions = {}
): Promise<DesktopAppContext> {
  const platform = options.platform ?? createDesktopPlatform(electronApp);
  const paths = platform.paths();
  const storeRepository = new AccountsStoreRepository(paths);
  const settingsRepository = new SettingsFileRepository(paths);
  const authRepository = new AuthFileRepository(paths);
  const smokePlatformSideEffects = createSmokePlatformSideEffects();
  const editorAppService = platform.editorApps();
  const settingsCoordinator = new SettingsCoordinator(
    settingsRepository,
    smokePlatformSideEffects?.launchAtStartupService ?? platform.launchAtStartupService()
  );
  const usageService = new DefaultUsageService(paths, {
    userAgent: platform.requestHeaders.codexToolsUserAgent
  });
  const weeklyQuotaWarmupService = new DefaultWeeklyQuotaWarmupService(paths);
  const workspaceMetadataService = new DefaultWorkspaceMetadataService(paths, {
    userAgent: platform.requestHeaders.codexToolsUserAgent
  });
  const chatGPTOAuthLoginService =
    smokePlatformSideEffects?.chatGPTOAuthLoginService ??
    new OpenAIChatGPTOAuthLoginService(paths, {
      localeProvider: async () => (await settingsRepository.loadSettings()).locale
    });
  const remoteModelCatalogService =
    smokePlatformSideEffects?.modelCatalogService ?? new RemoteModelCatalogService({ storeRepository });
  const accountsCoordinator = new AccountsCoordinator({
    storeRepository,
    settingsRepository,
    authRepository,
    usageService,
    weeklyQuotaWarmupService,
    workspaceMetadataService,
    chatGPTOAuthLoginService,
    codexCLIService: smokePlatformSideEffects?.codexCLIService ?? platform.codexLauncher(),
    editorAppService: smokePlatformSideEffects?.editorAppService ?? editorAppService,
    sourceDeviceID: platform.sourceDeviceID
  });
  const proxyRuntimeService = new ProxyRuntimeService(
    new ProxyCoordinator({
      storeRepository,
      settingsRepository,
      authRepository,
      codexConfigPath: paths.codexConfigPath,
      chatGPTOAuthLoginService,
      modelCatalogService: remoteModelCatalogService,
      upstreamClient:
        smokePlatformSideEffects?.proxyUpstreamClient ??
        new CodexUpstreamClient(undefined, {
          userAgent: platform.requestHeaders.codexUpstreamUserAgent
        })
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
    platform,
    proxyRuntimeService,
    smokePlatformSideEffects,
    storeRepository,
    settingsCoordinator
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
      proxyUpstreamClient: CodexUpstreamClientLike;
      modelCatalogService: {
        cachedAvailableModels(): string[] | undefined;
        cachedModelIDsByPlanKey(): ReadonlyMap<string, ReadonlySet<string>> | undefined;
        refreshModels(): Promise<string[] | undefined>;
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
    proxyUpstreamRequests: [],
    startupSetEnabledValues: [],
    startupSyncValues: []
  };
  const smokeModels = ["gpt-5-codex", "gpt-5", "gpt-5-mini"];
  const smokeModelsByPlanKey = new Map(
    ["codex-free", "codex-plus", "codex-pro", "codex-team"].map((planKey) => [planKey, new Set(smokeModels)])
  );

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
    modelCatalogService: {
      cachedAvailableModels(): string[] {
        return [...smokeModels];
      },
      cachedModelIDsByPlanKey(): ReadonlyMap<string, ReadonlySet<string>> {
        return smokeModelsByPlanKey;
      },
      async refreshModels(): Promise<string[]> {
        return [...smokeModels];
      }
    },
    proxyUpstreamClient: {
      async execute(request: CodexUpstreamRequest): Promise<CodexUpstreamResult> {
        const normalizedPath = normalizedSmokeUpstreamPath(request.url);
        log.proxyUpstreamRequests.push({
          accountId: request.accountId,
          bodyLength: request.body.byteLength,
          isStream: request.isStream,
          method: request.method,
          normalizedPath
        });

        switch (normalizedPath) {
          case "models":
            return smokeJSONUpstreamResult({
              data: smokeModels.map((id) => ({ id, object: "model" }))
            });
          case "responses":
            return smokeSSEUpstreamResult("ok", {
              id: "resp-smoke",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "ok" }]
                }
              ],
              usage: { input_tokens: 1, output_tokens: 1 }
            });
          case "responses/compact":
            return smokeJSONUpstreamResult({ id: "compact-smoke", compacted: true });
          case "memories/trace_summarize":
            return smokeJSONUpstreamResult({ id: "memory-smoke", summary: "ok" });
          case "alpha/search":
            return smokeJSONUpstreamResult({ results: [{ id: "search-smoke", title: "ok" }] });
          default:
            return smokeJSONUpstreamResult({ id: "smoke", path: normalizedPath });
        }
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
        proxyUpstreamRequests: log.proxyUpstreamRequests.map((entry) => ({ ...entry })),
        startupSetEnabledValues: [...log.startupSetEnabledValues],
        startupSyncValues: [...log.startupSyncValues]
      };
    }
  };
}

function normalizedSmokeUpstreamPath(url: string): string {
  const path = new URL(url).pathname;
  const marker = "/backend-api/codex/";
  const markerIndex = path.indexOf(marker);
  return markerIndex >= 0 ? path.slice(markerIndex + marker.length) : path.replace(/^\/+/, "");
}

function smokeJSONUpstreamResult(body: unknown): CodexUpstreamResult {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: Buffer.from(JSON.stringify(body), "utf8")
  };
}

function smokeSSEUpstreamResult(text: string, response: Record<string, unknown>): CodexUpstreamResult {
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8"
    },
    body: Buffer.from(
      [
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}`,
        "",
        `data: ${JSON.stringify({ type: "response.completed", response })}`,
        "",
        ""
      ].join("\n"),
      "utf8"
    )
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
