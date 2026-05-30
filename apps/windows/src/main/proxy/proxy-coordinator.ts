import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppSettings } from "../../shared/models/settings";
import type { AccountsStore, StoredAccount } from "../../shared/models/accounts";
import type { ExtractedAuth } from "../../shared/models/auth";
import { accountSummaries } from "../../shared/domain/accounts-store";
import { accountKeyForExtractedAuth } from "../../shared/domain/account-identity";
import { sortForDisplay } from "../../shared/domain/account-ranking";
import { resolveChatGPTBaseOrigin, removeSuffix } from "../services/chatgpt-base-origin";
import type { AccountsStoreRepositoryLike, AuthRepositoryLike } from "../services/accounts-coordinator";
import { translateChatRequest, translateCodexSSEToChatCompletion } from "./chat-to-codex-translator";
import { translateAnthropicRequest } from "./anthropic-to-codex-translator";
import { CodexUpstreamClient, CodexUpstreamError, isForwardableHeader, type CodexUpstreamClientLike, type CodexUpstreamResult } from "./upstream-client";

const maxRequestBytes = 50 * 1024 * 1024;

export interface SettingsRepositoryLike {
  loadSettings(): Promise<AppSettings>;
}

export interface ProxyCoordinatorOptions {
  storeRepository: AccountsStoreRepositoryLike;
  settingsRepository: SettingsRepositoryLike;
  authRepository: AuthRepositoryLike;
  codexConfigPath: string;
  upstreamClient?: CodexUpstreamClientLike;
  dateProvider?: { unixSecondsNow(): number };
}

export class ProxyCoordinator {
  private readonly upstreamClient: CodexUpstreamClientLike;
  private readonly dateProvider: { unixSecondsNow(): number };
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
      sendJson(response, 200, { ok: true });
      return;
    }

    const settings = await this.options.settingsRepository.loadSettings();
    if (!isAuthorized(request, settings.proxyApiKey)) {
      sendJson(response, 401, { error: { message: "Unauthorized", type: "authentication_error" } });
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/v1/models") {
        await this.forwardProxyRequest(request, response, "models", Buffer.alloc(0), true);
        return;
      }

      if (request.method !== "POST") {
        sendJson(response, 405, { error: { message: "Method Not Allowed" } });
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
          await this.forwardCodexJSON(request, response, "responses/compact", json, true);
          return;
        case "/v1/memories/trace_summarize":
          await this.forwardCodexJSON(request, response, "memories/trace_summarize", json, true);
          return;
        case "/v1/alpha/search":
          await this.forwardCodexJSON(request, response, "alpha/search", json, true);
          return;
        default:
          sendJson(response, 404, { error: { message: "Not Found" } });
      }
    } catch (error) {
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
    const model = readString(json.model, "model");
    const messages = Array.isArray(json.messages) ? json.messages.filter(isRecord) : [];
    const codexBody = translateChatRequest(model, messages, json);
    const result = await this.forwardProxyRequest(
      request,
      response,
      "responses",
      Buffer.from(JSON.stringify(codexBody)),
      true,
      false
    );

    if (json.stream === false) {
      sendJson(response, 200, translateCodexSSEToChatCompletion(model, result.body.toString("utf8")));
    } else {
      sendUpstream(response, result, "text/event-stream; charset=utf-8");
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
      false
    );
    sendUpstream(response, result, translation.isStream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8");
  }

  private async forwardCodexJSON(
    request: IncomingMessage,
    response: ServerResponse,
    normalizedPath: string,
    json: Record<string, unknown>,
    forceStream: boolean
  ): Promise<void> {
    const body = forceStream ? { ...json, stream: true } : json;
    const result = await this.forwardProxyRequest(
      request,
      response,
      normalizedPath,
      Buffer.from(JSON.stringify(body)),
      forceStream,
      false
    );
    sendUpstream(response, result, forceStream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8");
  }

  private async forwardProxyRequest(
    request: IncomingMessage,
    response: ServerResponse,
    normalizedPath: string,
    body: Buffer,
    isStream: boolean,
    writeResponse = true
  ): Promise<CodexUpstreamResult> {
    const store = await this.options.storeRepository.loadStore();
    const orderedAccounts = await this.orderedEligibleAccounts(store);
    const url = await this.upstreamURL(normalizedPath);
    let lastError: unknown;

    for (const account of orderedAccounts) {
      const extracted = this.extractAccount(account);
      if (!extracted) {
        continue;
      }

      try {
        const result = await this.upstreamClient.execute({
          method: request.method ?? "POST",
          url,
          body,
          headers: requestHeaders(request),
          accessToken: extracted.accessToken,
          accountId: extracted.accountId,
          isStream
        });
        if (writeResponse) {
          sendUpstream(response, result, isStream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8");
        }
        return result;
      } catch (error) {
        lastError = error;
        if (!(error instanceof CodexUpstreamError) || !error.isRetryable) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("No eligible account could satisfy the proxy request");
  }

  private async orderedEligibleAccounts(store: AccountsStore): Promise<StoredAccount[]> {
    const summaries = sortForDisplay(accountSummaries(store, await this.currentAuthAccountKey()));
    const byId = new Map(store.accounts.map((account) => [account.id, account]));
    return summaries
      .filter((summary) => !isAccountCoolingDown(summary.usage, this.dateProvider.unixSecondsNow()))
      .map((summary) => byId.get(summary.id))
      .filter((account): account is StoredAccount => account !== undefined);
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

  private async upstreamURL(normalizedPath: string): Promise<string> {
    const baseOrigin = await resolveChatGPTBaseOrigin(this.options.codexConfigPath);
    const backendPrefix = "/backend-api";
    const originWithoutBackend = removeSuffix(baseOrigin, backendPrefix);
    const normalized = normalizedPath.replace(/^\/+/, "");
    return originWithoutBackend
      ? `${originWithoutBackend}${backendPrefix}/codex/${normalized}`
      : `${baseOrigin}${backendPrefix}/codex/${normalized}`;
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

function isAccountCoolingDown(usage: StoredAccount["usage"], now: number): boolean {
  const windows = [usage?.fiveHour, usage?.oneWeek];
  return windows.some((window) => window !== undefined && window.usedPercent >= 100 && window.resetAt !== undefined && window.resetAt > now);
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
  const parsed = JSON.parse(body.toString("utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed;
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
    if (lower !== "transfer-encoding" && lower !== "content-length") {
      filtered[key] = value;
    }
  }
  return filtered;
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "authorization,content-type,x-api-key");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
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
