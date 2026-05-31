import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppSettings } from "../../shared/models/settings";
import type { AccountSummary, AccountsStore, StoredAccount } from "../../shared/models/accounts";
import type { ChatGPTOAuthTokens, ExtractedAuth } from "../../shared/models/auth";
import { appInfo } from "../../shared/app-info";
import { accountSummaries } from "../../shared/domain/accounts-store";
import { accountKeyForExtractedAuth, accountKeyForStoredAccount, normalizedAccountId } from "../../shared/domain/account-identity";
import { effectivePlanType, preferredPlanType } from "../../shared/domain/account-plan-resolver";
import { remainingScore } from "../../shared/domain/account-ranking";
import { resolveChatGPTBaseOrigin, removeSuffix } from "../services/chatgpt-base-origin";
import type { AccountsStoreRepositoryLike, AuthRepositoryLike } from "../services/accounts-coordinator";
import { tokenObjectFromAuth } from "../repositories/auth-parsing";
import {
  translateChatRequest,
  translateCodexSSEToChatCompletion,
  translateCodexSSEToChatCompletionChunks
} from "./chat-to-codex-translator";
import {
  translateAnthropicRequest,
  translateCodexSSEToAnthropicMessage,
  translateCodexSSEToAnthropicStream
} from "./anthropic-to-codex-translator";
import { CodexUpstreamClient, CodexUpstreamError, isForwardableHeader, type CodexUpstreamClientLike, type CodexUpstreamRequest, type CodexUpstreamResult } from "./upstream-client";
import { modelCatalogPlanKey } from "../services/remote-model-catalog-service";
import { collectCompletedResponseFromSSE, firstPreflightCodexSSEError } from "./codex-sse";

const maxRequestBytes = 50 * 1024 * 1024;
const accountCooldownSeconds = 60;
const authCooldownSeconds = 5 * 60;
const shortCooldownSeconds = 15;
const corsAllowedHeaders = [
  "Content-Type",
  "Authorization",
  "x-api-key",
  "anthropic-version",
  "session-id",
  "thread-id",
  "x-client-request-id",
  "x-codex-window-id",
  "x-codex-turn-metadata",
  "x-codex-turn-state",
  "x-codex-beta-features",
  "x-openai-subagent",
  "x-codex-parent-thread-id",
  "x-openai-memgen-request",
  "openai-beta",
  "version",
  "originator"
].join(", ");
const corsExposedHeaders = [
  "x-codex-turn-state",
  "x-request-id",
  "openai-model",
  "x-models-etag",
  "x-reasoning-included",
  "x-codex-ratelimit-reset-requests",
  "x-codex-ratelimit-remaining-requests",
  "x-codex-ratelimit-limit-requests",
  "x-codex-ratelimit-reset-tokens",
  "x-codex-ratelimit-remaining-tokens",
  "x-codex-ratelimit-limit-tokens"
].join(", ");
const supportedPostPaths = new Set([
  "/v1/chat/completions",
  "/v1/messages",
  "/v1/responses",
  "/v1/responses/compact",
  "/v1/memories/trace_summarize",
  "/v1/alpha/search"
]);
const unsupportedRouteMessage =
  "Proxy only supports GET /health, GET /v1/models, POST /v1/chat/completions, POST /v1/responses, POST /v1/responses/compact, POST /v1/memories/trace_summarize, POST /v1/alpha/search";
const noAccountsAvailableMessage = "No accounts available for proxy. Add and authorize at least one account first.";

interface ProxyAccountSelection {
  accounts: Array<{ account: StoredAccount; extracted: ExtractedAuth }>;
  hasStoredAccounts: boolean;
  unavailableReasons: string[];
}

export interface SettingsRepositoryLike {
  loadSettings(): Promise<AppSettings>;
}

export interface ProxyCoordinatorOptions {
  storeRepository: AccountsStoreRepositoryLike;
  settingsRepository: SettingsRepositoryLike;
  authRepository: AuthRepositoryLike;
  codexConfigPath: string;
  chatGPTOAuthLoginService?: ProxyRefreshTokenServiceLike;
  modelCatalogService?: ProxyModelCatalogServiceLike;
  upstreamClient?: CodexUpstreamClientLike;
  dateProvider?: { unixSecondsNow(): number };
}

export interface ProxyRefreshTokenServiceLike {
  refreshChatGPTTokens(refreshToken: string): Promise<ChatGPTOAuthTokens>;
}

export interface ProxyModelCatalogServiceLike {
  cachedModelIDsByPlanKey(): ReadonlyMap<string, ReadonlySet<string>> | undefined;
}

export class ProxyCoordinator {
  private readonly upstreamClient: CodexUpstreamClientLike;
  private readonly dateProvider: { unixSecondsNow(): number };
  private readonly accountCooldowns = new Map<string, number>();
  private readonly accountModelCooldowns = new Map<string, number>();
  private server: Server | undefined;

  constructor(private readonly options: ProxyCoordinatorOptions) {
    this.upstreamClient = options.upstreamClient ?? new CodexUpstreamClient();
    this.dateProvider = options.dateProvider ?? { unixSecondsNow: () => Math.floor(Date.now() / 1000) };
  }

  async start(port?: number): Promise<number> {
    if (this.server) {
      const address = this.server.address() as AddressInfo | null;
      return address?.port ?? 0;
    }

    const settings = await this.options.settingsRepository.loadSettings();
    const listenPort = port ?? settings.proxyPort;
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await listen(this.server, listenPort);
    const address = this.server.address() as AddressInfo | null;
    return address?.port ?? listenPort;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = undefined;
    await closeServer(server);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    setCorsHeaders(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    const settings = await this.options.settingsRepository.loadSettings();
    if (!isAuthorized(request, settings.proxyApiKey)) {
      sendJson(response, 401, { error: { message: "Unauthorized", type: "authentication_error" } });
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/v1/models") {
        await this.forwardProxyRequest(request, response, "models", Buffer.alloc(0), false, "", true, modelsQueryString(request, url));
        return;
      }

      if (request.method !== "POST") {
        sendProxyError(response, 404, unsupportedRouteMessage);
        return;
      }

      if (!supportedPostPaths.has(url.pathname)) {
        sendProxyError(response, 404, unsupportedRouteMessage);
        return;
      }

      const body = await readRequestBody(request);
      const json = parseJsonObject(body);
      switch (url.pathname) {
        case "/v1/chat/completions":
          await this.handleChatCompletions(request, response, json);
          return;
        case "/v1/messages":
          await this.handleAnthropicMessages(request, response, json);
          return;
        case "/v1/responses":
          await this.forwardCodexJSON(request, response, "responses", json, true);
          return;
        case "/v1/responses/compact":
          await this.forwardCodexJSONPassthrough(request, response, "responses/compact", body, json);
          return;
        case "/v1/memories/trace_summarize":
          await this.forwardCodexJSONPassthrough(request, response, "memories/trace_summarize", body, json);
          return;
        case "/v1/alpha/search":
          await this.forwardCodexJSONPassthrough(request, response, "alpha/search", body, json, "");
          return;
      }
    } catch (error) {
      if (error instanceof ProxyBadRequestError) {
        sendProxyError(response, 400, error.message);
        return;
      }
      if (error instanceof ProxyResponseError) {
        sendProxyError(response, error.statusCode, error.message);
        return;
      }
      sendJson(response, error instanceof CodexUpstreamError ? error.statusCode : 500, {
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: "proxy_error"
        }
      });
    }
  }

  private async handleChatCompletions(
    request: IncomingMessage,
    response: ServerResponse,
    json: Record<string, unknown>
  ): Promise<void> {
    const model = readOptionalString(json.model);
    if (!model) {
      sendProxyError(response, 400, "Missing required field: model");
      return;
    }

    if (!Array.isArray(json.messages)) {
      sendProxyError(response, 400, "Chat request missing messages array");
      return;
    }

    const messages = json.messages.filter(isRecord);
    const clientWantsStream = json.stream === true;
    const codexBody = translateChatRequest(model, messages, json);
    const result = await this.forwardProxyRequest(
      request,
      response,
      "responses",
      Buffer.from(JSON.stringify(codexBody)),
      true,
      model,
      false
    );

    if (clientWantsStream) {
      sendText(
        response,
        200,
        translateCodexSSEToChatCompletionChunks(model, result.body.toString("utf8")),
        "text/event-stream; charset=utf-8"
      );
    } else {
      sendJson(response, 200, translateCodexSSEToChatCompletion(model, result.body.toString("utf8")));
    }
  }

  private async handleAnthropicMessages(
    request: IncomingMessage,
    response: ServerResponse,
    json: Record<string, unknown>
  ): Promise<void> {
    const translation = translateAnthropicRequest(json);
    if (!translation) {
      sendJson(response, 400, { error: { message: "Invalid Anthropic request" } });
      return;
    }

    const result = await this.forwardProxyRequest(
      request,
      response,
      "responses",
      Buffer.from(JSON.stringify(translation.codexBody)),
      true,
      readOptionalString(json.model) ?? "",
      false
    );
    if (translation.isStream) {
      sendText(
        response,
        200,
        translateCodexSSEToAnthropicStream(translation.model, result.body.toString("utf8")),
        "text/event-stream; charset=utf-8"
      );
    } else {
      const translated = translateCodexSSEToAnthropicMessage(translation.model, result.body.toString("utf8"));
      sendJson(response, translated.statusCode, translated.body);
    }
  }

  private async forwardCodexJSON(
    request: IncomingMessage,
    response: ServerResponse,
    normalizedPath: string,
    json: Record<string, unknown>,
    forceStream: boolean
  ): Promise<void> {
    const model = readOptionalString(json.model) ?? "";
    const clientWantsStream = json.stream !== false;
    const body = forceStream ? normalizedResponsesBody(json) : json;
    const result = await this.forwardProxyRequest(
      request,
      response,
      normalizedPath,
      Buffer.from(JSON.stringify(body)),
      forceStream,
      model,
      false
    );
    if (forceStream && !clientWantsStream) {
      const completed = collectCompletedResponseFromSSE(result.body.toString("utf8"));
      sendJson(response, completed.statusCode, completed.body, result.headers);
      return;
    }
    sendUpstream(response, result, forceStream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8");
  }

  private async forwardCodexJSONPassthrough(
    request: IncomingMessage,
    response: ServerResponse,
    normalizedPath: string,
    body: Buffer,
    json: Record<string, unknown>,
    defaultModel = "gpt-5"
  ): Promise<void> {
    const model = readOptionalString(json.model) ?? defaultModel;
    const result = await this.forwardProxyRequest(
      request,
      response,
      normalizedPath,
      body,
      false,
      model,
      false
    );
    sendUpstream(response, result, "application/json; charset=utf-8");
  }

  private async forwardProxyRequest(
    request: IncomingMessage,
    response: ServerResponse,
    normalizedPath: string,
    body: Buffer,
    isStream: boolean,
    model: string,
    writeResponse = true,
    queryString = ""
  ): Promise<CodexUpstreamResult> {
    const store = await this.options.storeRepository.loadStore();
    const selection = await this.selectEligibleAccounts(store, model);
    if (selection.accounts.length === 0) {
      if (selection.hasStoredAccounts) {
        throw new ProxyResponseError(429, allAccountsUnavailableMessage(selection.unavailableReasons));
      }
      throw new ProxyResponseError(503, noAccountsAvailableMessage);
    }

    const url = await this.upstreamURL(normalizedPath, queryString);
    const failures: string[] = [];

    for (const { account, extracted } of selection.accounts) {
      try {
        const result = await this.executeUpstreamRequest({
          method: request.method ?? "POST",
          url,
          body,
          headers: requestHeaders(request),
          isStream
        }, account, extracted, model);
        if (writeResponse) {
          sendUpstream(response, result, isStream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8");
        }
        return result;
      } catch (error) {
        failures.push(`${account.label}: ${error instanceof Error ? error.message : String(error)}`);
        if (!(error instanceof CodexUpstreamError) || !error.isRetryable) {
          throw error;
        }
      }
    }

    throw new ProxyResponseError(502, upstreamFailedMessage([...failures, ...selection.unavailableReasons]));
  }

  private async executeUpstreamRequest(
    request: Omit<CodexUpstreamRequest, "accessToken" | "accountId">,
    account: StoredAccount,
    extracted: ExtractedAuth,
    model: string
  ): Promise<CodexUpstreamResult> {
    try {
      return this.preflightUpstreamResult(
        await this.upstreamClient.execute({
          ...request,
          accessToken: extracted.accessToken,
          accountId: extracted.accountId
        }),
        request.isStream
      );
    } catch (error) {
      if (error instanceof CodexUpstreamError && isAuthenticationFailure(error)) {
        const refreshed = await this.refreshProxyAccountAuth(account);
        if (refreshed) {
          try {
            return this.preflightUpstreamResult(
              await this.upstreamClient.execute({
                ...request,
                accessToken: refreshed.extracted.accessToken,
                accountId: refreshed.extracted.accountId
              }),
              request.isStream
            );
          } catch (refreshedError) {
            this.recordCooldown(refreshed.account, model, refreshedError);
            throw refreshedError;
          }
        }
      }

      this.recordCooldown(account, model, error);
      throw error;
    }
  }

  private preflightUpstreamResult(result: CodexUpstreamResult, isStream: boolean): CodexUpstreamResult {
    if (!isStream) {
      return result;
    }
    const error = firstPreflightCodexSSEError(result.body.toString("utf8"));
    if (!error) {
      return result;
    }
    throw new CodexUpstreamError(error.statusCode, `SSE ${error.statusCode}`, error.body);
  }

  private async selectEligibleAccounts(store: AccountsStore, model: string): Promise<ProxyAccountSelection> {
    const now = this.dateProvider.unixSecondsNow();
    this.expireCooldowns(now);
    const summaries = accountSummaries(store).sort((left, right) => {
      const scoreDelta = remainingScore(right) - remainingScore(left);
      return scoreDelta !== 0 ? scoreDelta : left.addedAt - right.addedAt;
    });
    const byId = new Map(store.accounts.map((account) => [account.id, account]));
    const accounts: ProxyAccountSelection["accounts"] = [];
    const unavailableReasons: string[] = [];

    for (const summary of summaries) {
      const account = byId.get(summary.id);
      if (!account) {
        continue;
      }

      const unavailableReason = this.accountUnavailableReason(account, summary, model, now);
      if (unavailableReason) {
        unavailableReasons.push(unavailableReason);
        continue;
      }

      const extracted = this.extractAccount(account);
      if (!extracted) {
        unavailableReasons.push(`${account.label}: auth unavailable`);
        continue;
      }

      accounts.push({ account, extracted });
    }

    return {
      accounts,
      hasStoredAccounts: store.accounts.length > 0,
      unavailableReasons
    };
  }

  private accountUnavailableReason(
    account: StoredAccount,
    summary: AccountSummary,
    model: string,
    now: number
  ): string | undefined {
    const accountKey = accountKeyForStoredAccount(account);
    const quotaResetTime = exhaustedQuotaResetTime(account.usage, now);
    if (quotaResetTime !== undefined) {
      this.accountCooldowns.set(accountKey, quotaResetTime);
      return `${account.label}: quota resets ${formatResetTime(quotaResetTime)}`;
    }

    const cooldownUntil = this.accountCooldowns.get(accountKey);
    if (cooldownUntil !== undefined && cooldownUntil > now) {
      return `${account.label}: cooling down until ${formatResetTime(cooldownUntil)}`;
    }

    const modelCooldownUntil = this.accountModelCooldowns.get(modelCooldownKey(accountKey, model));
    if (modelCooldownUntil !== undefined && modelCooldownUntil > now) {
      return `${account.label}: model ${model} cooling down until ${formatResetTime(modelCooldownUntil)}`;
    }

    if (!this.modelIsSupported(model, account)) {
      return `${account.label}: model ${model} unavailable for ${summary.effectivePlanType}`;
    }

    return undefined;
  }

  private modelIsSupported(model: string, account: StoredAccount): boolean {
    if (!model) {
      return true;
    }
    const modelsByPlanKey = this.options.modelCatalogService?.cachedModelIDsByPlanKey();
    if (!modelsByPlanKey || modelsByPlanKey.size === 0) {
      return true;
    }
    const planKey = modelCatalogPlanKey(effectivePlanType(account.planType, account.usage?.planType));
    return modelsByPlanKey.get(planKey)?.has(model) === true;
  }

  private async currentAuthAccountKey(): Promise<string | undefined> {
    const auth = await this.options.authRepository.readCurrentAuthOptional();
    if (!auth) {
      return undefined;
    }
    try {
      return accountKeyForExtractedAuth(this.options.authRepository.extractAuth(auth));
    } catch {
      return undefined;
    }
  }

  private extractAccount(account: StoredAccount): ExtractedAuth | undefined {
    try {
      return this.options.authRepository.extractAuth(account.authJson);
    } catch {
      return undefined;
    }
  }

  private async refreshProxyAccountAuth(
    account: StoredAccount
  ): Promise<{ account: StoredAccount; extracted: ExtractedAuth } | undefined> {
    const refreshToken = refreshTokenFromAuth(account.authJson);
    if (!this.options.chatGPTOAuthLoginService || !refreshToken) {
      return undefined;
    }

    try {
      const tokens = await this.options.chatGPTOAuthLoginService.refreshChatGPTTokens(refreshToken);
      const authJson = this.options.authRepository.replacingChatGPTTokens(account.authJson, tokens);
      const extracted = this.options.authRepository.extractAuth(authJson);
      if (normalizedAccountId(extracted.accountId) !== normalizedAccountId(account.accountId)) {
        return undefined;
      }

      const store = await this.options.storeRepository.loadStore();
      const index = store.accounts.findIndex((candidate) => candidate.id === account.id);
      const stored = store.accounts[index];
      if (index < 0 || !stored) {
        return undefined;
      }

      const updated: StoredAccount = {
        ...stored,
        accountId: extracted.accountId,
        authJson,
        email: extracted.email ?? stored.email,
        planType: preferredPlanType(extracted.planType, stored.usage?.planType, stored.planType),
        principalId: extracted.principalId,
        teamName: normalizeTeamName(extracted.teamName) ?? stored.teamName,
        updatedAt: this.dateProvider.unixSecondsNow()
      };
      store.accounts[index] = updated;
      await this.options.storeRepository.saveStore(store);

      if ((await this.currentAuthAccountKey()) === accountKeyForStoredAccount(account)) {
        await this.options.authRepository.writeCurrentAuth(authJson);
      }

      return { account: updated, extracted };
    } catch {
      return undefined;
    }
  }

  private recordCooldown(account: StoredAccount, model: string, error: unknown): void {
    if (!(error instanceof CodexUpstreamError)) {
      this.accountCooldowns.set(accountKeyForStoredAccount(account), this.dateProvider.unixSecondsNow() + shortCooldownSeconds);
      return;
    }

    const now = this.dateProvider.unixSecondsNow();
    const accountKey = accountKeyForStoredAccount(account);
    if (isAuthenticationFailure(error)) {
      this.accountCooldowns.set(accountKey, now + authCooldownSeconds);
      return;
    }
    if (isRateLimited(error)) {
      this.accountCooldowns.set(accountKey, quotaRetryCooldown(account.usage, now));
      return;
    }
    if (isModelRestriction(error) && model) {
      this.accountModelCooldowns.set(modelCooldownKey(accountKey, model), now + authCooldownSeconds);
      return;
    }
    if (error.isRetryable) {
      this.accountCooldowns.set(accountKey, now + shortCooldownSeconds);
    }
  }

  private expireCooldowns(now: number): void {
    expireMap(this.accountCooldowns, now);
    expireMap(this.accountModelCooldowns, now);
  }

  private async upstreamURL(normalizedPath: string, queryString = ""): Promise<string> {
    const baseOrigin = await resolveChatGPTBaseOrigin(this.options.codexConfigPath);
    const backendPrefix = "/backend-api";
    const originWithoutBackend = removeSuffix(baseOrigin, backendPrefix);
    const normalized = normalizedPath.replace(/^\/+/, "");
    const baseURL = originWithoutBackend
      ? `${originWithoutBackend}${backendPrefix}/codex/${normalized}`
      : `${baseOrigin}${backendPrefix}/codex/${normalized}`;
    return queryString ? `${baseURL}${queryString.startsWith("?") ? queryString : `?${queryString}`}` : baseURL;
  }
}

function isAuthorized(request: IncomingMessage, apiKey: string): boolean {
  if (!apiKey) {
    return false;
  }
  const xApiKey = request.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey === apiKey) {
    return true;
  }
  const authorization = request.headers.authorization;
  return authorization === `Bearer ${apiKey}`;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxRequestBytes) {
      throw new Error("Request body exceeded maximum size");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseJsonObject(body: Buffer): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new ProxyBadRequestError("Request body must be a JSON object");
  }
  if (!isRecord(parsed)) {
    throw new ProxyBadRequestError("Request body must be a JSON object");
  }
  return parsed;
}

class ProxyBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyBadRequestError";
  }
}

class ProxyResponseError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "ProxyResponseError";
  }
}

function allAccountsUnavailableMessage(unavailableReasons: readonly string[]): string {
  const summary = unavailableReasons.length > 0 ? unavailableReasons.join("; ") : noAccountsAvailableMessage;
  return `All accounts are unavailable: ${summary}`;
}

function upstreamFailedMessage(details: readonly string[]): string {
  const summary = details.length > 0 ? details.join("; ") : "No eligible account could satisfy the proxy request";
  return `Codex upstream request failed: ${summary}`;
}

function normalizedResponsesBody(json: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { ...json, stream: true };
  body.store ??= false;
  body.instructions ??= "";
  body.tools ??= [];
  body.tool_choice ??= "auto";
  body.parallel_tool_calls ??= true;
  body.include ??= body.reasoning === undefined ? [] : ["reasoning.encrypted_content"];
  return body;
}

function requestHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string" && isForwardableHeader(key)) {
      headers[key.toLowerCase()] = value;
    }
  }
  return headers;
}

function modelsQueryString(request: IncomingMessage, url: URL): string {
  if (!url.searchParams.has("client_version")) {
    const version = typeof request.headers.version === "string" ? request.headers.version.trim() : "";
    url.searchParams.append("client_version", version.length > 0 ? version : appInfo.version);
  }
  const queryString = url.searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

function sendUpstream(response: ServerResponse, result: CodexUpstreamResult, contentType: string): void {
  const headers: Record<string, string> = {
    ...filterResponseHeaders(result.headers),
    "Content-Type": result.headers["content-type"] ?? contentType,
    "Content-Length": String(result.body.byteLength)
  };
  response.writeHead(result.statusCode, headers);
  response.end(result.body);
}

function filterResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower !== "transfer-encoding" && lower !== "content-length" && lower !== "content-type") {
      filtered[key] = value;
    }
  }
  return filtered;
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown, headers: Record<string, string> = {}): void {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(statusCode, {
    ...filterResponseHeaders(headers),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.byteLength)
  });
  response.end(body);
}

function sendProxyError(response: ServerResponse, statusCode: number, message: string): void {
  sendJson(response, statusCode, {
    error: {
      message,
      type: "proxy_error"
    }
  });
}

function sendText(response: ServerResponse, statusCode: number, value: string, contentType: string): void {
  const body = Buffer.from(value, "utf8");
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": String(body.byteLength)
  });
  response.end(body);
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "http://localhost");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", corsAllowedHeaders);
  response.setHeader("Access-Control-Expose-Headers", corsExposedHeaders);
  response.setHeader("Access-Control-Max-Age", "86400");
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function refreshTokenFromAuth(auth: StoredAccount["authJson"]): string | undefined {
  const tokens = tokenObjectFromAuth(auth);
  const refreshToken = tokens?.refresh_token;
  return typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : undefined;
}

function isAuthenticationFailure(error: CodexUpstreamError): boolean {
  const body = error.body.toLowerCase();
  return error.statusCode === 401 || body.includes("authentication") || body.includes("unauthorized") || body.includes("invalid_api_key");
}

function isRateLimited(error: CodexUpstreamError): boolean {
  return error.statusCode === 429;
}

function isModelRestriction(error: CodexUpstreamError): boolean {
  const body = error.body.toLowerCase();
  return error.statusCode === 403 && (body.includes("model_restricted") || body.includes("model_not_found"));
}

function exhaustedQuotaResetTime(usage: StoredAccount["usage"], now: number): number | undefined {
  const exhausted = [usage?.fiveHour, usage?.oneWeek].flatMap((window) =>
    window !== undefined && window.usedPercent >= 100 ? [window] : []
  );
  if (exhausted.length === 0) {
    return undefined;
  }

  const futureResetTimes = exhausted
    .map((window) => window.resetAt)
    .filter((resetAt): resetAt is number => resetAt !== undefined && resetAt > now);
  if (futureResetTimes.length > 0) {
    return Math.max(...futureResetTimes);
  }

  return exhausted.some((window) => window.resetAt === undefined) ? now + shortCooldownSeconds : undefined;
}

function quotaRetryCooldown(usage: StoredAccount["usage"], now: number): number {
  return exhaustedQuotaResetTime(usage, now) ?? now + accountCooldownSeconds;
}

function formatResetTime(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

function modelCooldownKey(accountKey: string, model: string): string {
  return `${accountKey}|${model}`;
}

function expireMap(map: Map<string, number>, now: number): void {
  for (const [key, value] of map.entries()) {
    if (value <= now) {
      map.delete(key);
    }
  }
}

function normalizeTeamName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
