import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { FileSystemPaths } from "../../repositories/file-system-paths";
import type { ChatGPTOAuthTokens } from "../../../shared/models/auth";
import { decodeJwtPayload, stringAtPath } from "../../repositories/auth-parsing";
import { boundedResponseText } from "../bounded-response";
import { resolveForcedWorkspaceID } from "../chatgpt-base-origin";
import { NetworkRequestError, UnauthorizedError } from "../network-errors";
import type { FetchLike } from "../endpoint-request-coordinator";
import { makePKCECodes, randomBase64URL, type PKCECodes } from "./pkce";
import { ChatGPTRefreshTokenExchangeCoordinator } from "./refresh-token-exchange-coordinator";
import { oauthMessage, type OAuthMessageKey } from "./oauth-messages";

const issuer = "https://auth.openai.com";
const clientID = "app_EMoamEEZ73f0CkXaXp7hrann";
const originator = "codex_cli_rs";
const callbackPath = "/auth/callback";
const preferredCallbackPort = 1455;
const maxPortScanOffset = 12;
const scopes = "openid profile email offline_access api.connectors.read api.connectors.invoke";

export interface OpenAIChatGPTOAuthLoginServiceOptions {
  fetchImpl?: FetchLike;
  openExternal?: (url: string) => Promise<boolean> | boolean;
  refreshCoordinator?: ChatGPTRefreshTokenExchangeCoordinator;
  stateFactory?: () => string;
  pkceFactory?: () => PKCECodes;
  localeProvider?: () => Promise<string | undefined> | string | undefined;
}

interface TokenExchangeResponse {
  accessToken: string;
  refreshToken: string;
  idToken: string;
}

export class OpenAIChatGPTOAuthLoginService {
  private readonly fetchImpl: FetchLike;
  private readonly openExternal: (url: string) => Promise<boolean> | boolean;
  private readonly refreshCoordinator: ChatGPTRefreshTokenExchangeCoordinator;
  private readonly stateFactory: () => string;
  private readonly pkceFactory: () => PKCECodes;
  private readonly localeProvider: () => Promise<string | undefined> | string | undefined;

  constructor(
    private readonly paths: Pick<FileSystemPaths, "codexConfigPath">,
    options: OpenAIChatGPTOAuthLoginServiceOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.openExternal = options.openExternal ?? openWithElectronShell;
    this.refreshCoordinator = options.refreshCoordinator ?? new ChatGPTRefreshTokenExchangeCoordinator();
    this.stateFactory = options.stateFactory ?? (() => randomBase64URL(32));
    this.pkceFactory = options.pkceFactory ?? makePKCECodes;
    this.localeProvider = options.localeProvider ?? (() => "en");
  }

  async signInWithChatGPT(timeoutSeconds: number, allowedWorkspaceId?: string): Promise<ChatGPTOAuthTokens> {
    const pkce = this.pkceFactory();
    const state = this.stateFactory();
    const forcedWorkspaceId = normalizeWorkspaceId(allowedWorkspaceId) ?? (await resolveForcedWorkspaceID(this.paths.codexConfigPath));
    const callback = new OAuthCallback<ChatGPTOAuthTokens>();
    const { server, port } = await this.makeCallbackServer(callback, pkce, state, forcedWorkspaceId);
    const redirectUri = redirectURI(port);
    const authorizeURL = makeAuthorizeURL({
      redirectUri,
      pkce,
      state,
      forcedWorkspaceId
    });

    try {
      const didOpen = await this.openExternal(authorizeURL.toString());
      if (!didOpen) {
        throw new Error(await this.message("browserOpenFailed"));
      }
      const timeoutMessage = await this.message("addAccountTimeout");
      return await callback.wait(timeoutSeconds * 1000, () => new Error(timeoutMessage));
    } finally {
      await closeServer(server);
    }
  }

  async refreshChatGPTTokens(refreshToken: string): Promise<ChatGPTOAuthTokens> {
    return this.refreshCoordinator.refresh(refreshToken, () => this.refreshTokens(refreshToken));
  }

  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    pkce: PKCECodes,
    forcedWorkspaceId?: string
  ): Promise<ChatGPTOAuthTokens> {
    const tokenResponse = await this.postTokenForm([
      ["grant_type", "authorization_code"],
      ["code", code],
      ["redirect_uri", redirectUri],
      ["client_id", clientID],
      ["code_verifier", pkce.codeVerifier]
    ]);

    if (forcedWorkspaceId) {
      const accountId = extractAccountIDFromIDToken(tokenResponse.idToken);
      if (accountId !== forcedWorkspaceId) {
        throw new UnauthorizedError(await this.message("workspaceMismatchFormat", forcedWorkspaceId));
      }
    }

    return {
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      idToken: tokenResponse.idToken,
      apiKey: await this.exchangeIDTokenForAPIKeyOptional(tokenResponse.idToken)
    };
  }

  private async makeCallbackServer(
    callback: OAuthCallback<ChatGPTOAuthTokens>,
    pkce: PKCECodes,
    state: string,
    forcedWorkspaceId: string | undefined
  ): Promise<{ server: Server; port: number }> {
    let lastError: unknown;
    for (let offset = 0; offset <= maxPortScanOffset; offset += 1) {
      const port = preferredCallbackPort + offset;
      try {
        const redirectUri = redirectURI(port);
        const server = createServer((request, response) => {
          void this.handleCallback(request, response, redirectUri, pkce, state, forcedWorkspaceId, callback);
        });
        await listen(server, port);
        return { server, port };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(await this.message("callbackServerStartFailed"));
  }

  private async handleCallback(
    request: IncomingMessage,
    response: ServerResponse,
    redirectUri: string,
    pkce: PKCECodes,
    state: string,
    forcedWorkspaceId: string | undefined,
    callback: OAuthCallback<ChatGPTOAuthTokens>
  ): Promise<void> {
    if (request.method !== "GET") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }

    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (requestUrl.pathname === "/cancel") {
      const error = new Error(await this.message("requestCancelled"));
      callback.fail(error);
      sendHTML(response, 200, errorPageHTML(error.message));
      return;
    }

    if (requestUrl.pathname !== callbackPath) {
      sendText(response, 404, "Not Found");
      return;
    }

    if (requestUrl.searchParams.get("state") !== state) {
      const error = new UnauthorizedError(await this.message("callbackStateMismatch"));
      callback.fail(error);
      sendHTML(response, 400, errorPageHTML(error.message));
      return;
    }

    const code = requestUrl.searchParams.get("code");
    if (code) {
      try {
        const tokens = await this.exchangeCodeForTokens(code, redirectUri, pkce, forcedWorkspaceId);
        callback.succeed(tokens);
        sendHTML(response, 200, successPageHTML());
      } catch (error) {
        callback.fail(error);
        sendHTML(response, 500, errorPageHTML(error instanceof Error ? error.message : String(error)));
      }
      return;
    }

    const errorCode = requestUrl.searchParams.get("error");
    if (errorCode) {
      const description = requestUrl.searchParams.get("error_description")?.trim();
      const message = description || errorCode;
      const error = new UnauthorizedError(await this.message("callbackFailedFormat", message));
      callback.fail(error);
      sendHTML(response, 401, errorPageHTML(error.message));
      return;
    }

    const error = new Error(await this.message("callbackMissingCode"));
    callback.fail(error);
    sendHTML(response, 400, errorPageHTML(error.message));
  }

  private async refreshTokens(refreshToken: string): Promise<ChatGPTOAuthTokens> {
    const tokenResponse = await this.postTokenForm([
      ["grant_type", "refresh_token"],
      ["refresh_token", refreshToken],
      ["client_id", clientID]
    ]);
    return {
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      idToken: tokenResponse.idToken,
      apiKey: await this.exchangeIDTokenForAPIKeyOptional(tokenResponse.idToken)
    };
  }

  private async exchangeIDTokenForAPIKeyOptional(idToken: string): Promise<string | undefined> {
    try {
      const response = await this.fetchImpl(endpointURL("/oauth/token"), {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: formEncodedBody([
          ["grant_type", "urn:ietf:params:oauth:grant-type:token-exchange"],
          ["client_id", clientID],
          ["requested_token", "openai-api-key"],
          ["subject_token", idToken],
          ["subject_token_type", "urn:ietf:params:oauth:token-type:id_token"]
        ])
      });

      if (!response.ok) {
        throw new Error("API key exchange failed");
      }

      const object = asRecord(await response.json(), "API key exchange response");
      return readString(object.access_token, "access_token");
    } catch {
      return undefined;
    }
  }

  private async postTokenForm(items: readonly (readonly [string, string])[]): Promise<TokenExchangeResponse> {
    const response = await this.fetchImpl(endpointURL("/oauth/token"), {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formEncodedBody(items)
    });

    if (!response.ok) {
      const detail = await boundedResponseText(response);
      throw new NetworkRequestError(await this.message("tokenExchangeFailedFormat", detail || `HTTP ${response.status}`));
    }

    return parseTokenExchangeResponse(await response.json());
  }

  private async message(key: OAuthMessageKey, replacement?: string): Promise<string> {
    try {
      return oauthMessage(await this.localeProvider(), key, replacement);
    } catch {
      return oauthMessage("en", key, replacement);
    }
  }
}

export function makeAuthorizeURL(options: {
  redirectUri: string;
  pkce: PKCECodes;
  state: string;
  forcedWorkspaceId?: string;
}): URL {
  const url = new URL(endpointURL("/oauth/authorize"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientID);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("code_challenge", options.pkce.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("state", options.state);
  url.searchParams.set("originator", originator);
  if (options.forcedWorkspaceId) {
    url.searchParams.set("allowed_workspace_id", options.forcedWorkspaceId);
  }
  return url;
}

export function formEncodedBody(items: readonly (readonly [string, string])[]): string {
  return items.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}

export function extractAccountIDFromIDToken(idToken: string): string {
  const payload = decodeJwtPayload(idToken);
  const accountId = stringAtPath(["https://api.openai.com/auth", "chatgpt_account_id"], payload);
  if (!accountId) {
    throw new Error("id_token is missing chatgpt_account_id");
  }
  return accountId;
}

function parseTokenExchangeResponse(value: unknown): TokenExchangeResponse {
  const object = asRecord(value, "token exchange response");
  return {
    accessToken: readString(object.access_token, "access_token"),
    refreshToken: readString(object.refresh_token, "refresh_token"),
    idToken: readString(object.id_token, "id_token")
  };
}

function endpointURL(path: string): string {
  return new URL(path, issuer).toString();
}

function redirectURI(port: number): string {
  return `http://localhost:${port}${callbackPath}`;
}

function normalizeWorkspaceId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function successPageHTML(): string {
  return "<html><head><meta charset=\"utf-8\"><title>CodexManager</title></head><body style=\"font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:32px;\"><h2>Sign-in complete</h2><p>You can return to CodexManager.</p></body></html>";
}

function errorPageHTML(message: string): string {
  return `<html><head><meta charset="utf-8"><title>CodexManager</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:32px;"><h2>Sign-in failed</h2><p>${htmlEscape(message)}</p></body></html>`;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function sendText(response: ServerResponse, statusCode: number, text: string): void {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function sendHTML(response: ServerResponse, statusCode: number, html: string): void {
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
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
  if (!(server.address() as AddressInfo | null)) {
    return;
  }
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

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

async function openWithElectronShell(url: string): Promise<boolean> {
  const electron = await import("electron");
  await electron.shell.openExternal(url);
  return true;
}

class OAuthCallback<Value> {
  private settled = false;
  private resolveWaiter?: (value: Value) => void;
  private rejectWaiter?: (error: Error) => void;
  private value?: Value;
  private error?: Error;

  wait(timeoutMilliseconds: number, timeoutError: () => Error): Promise<Value> {
    if (this.settled) {
      return this.error ? Promise.reject(this.error) : Promise.resolve(this.value as Value);
    }

    return new Promise<Value>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(timeoutError());
      }, Math.max(0, timeoutMilliseconds));

      this.resolveWaiter = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      this.rejectWaiter = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  }

  succeed(value: Value): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.value = value;
    this.resolveWaiter?.(value);
    this.clearWaiters();
  }

  fail(error: unknown): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.error = error instanceof Error ? error : new Error(String(error));
    this.rejectWaiter?.(this.error);
    this.clearWaiters();
  }

  private clearWaiters(): void {
    this.resolveWaiter = undefined;
    this.rejectWaiter = undefined;
  }
}
