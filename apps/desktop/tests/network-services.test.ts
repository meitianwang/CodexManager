import { describe, expect, it } from "vitest";
import type { ChatGPTOAuthTokens } from "../src/shared/models/auth";
import { appLocales } from "../src/shared/models/settings";
import type { FetchLike } from "../src/main/services/endpoint-request-coordinator";
import { oauthMessage, type OAuthMessageKey } from "../src/main/services/oauth/oauth-messages";
import { ChatGPTRefreshTokenExchangeCoordinator } from "../src/main/services/oauth/refresh-token-exchange-coordinator";
import {
  formEncodedBody,
  makeAuthorizeURL,
  OpenAIChatGPTOAuthLoginService
} from "../src/main/services/oauth/openai-chatgpt-oauth-service";
import { DefaultUsageService, mapUsagePayload } from "../src/main/services/usage-service";
import {
  DefaultWorkspaceMetadataService,
  mapWorkspaceMetadataPayload
} from "../src/main/services/workspace-metadata-service";
import { DefaultWeeklyQuotaWarmupService, makeWarmupBodyBuffer } from "../src/main/services/weekly-quota-warmup-service";
import {
  CodexUpstreamError,
  type CodexUpstreamClientLike,
  type CodexUpstreamRequest,
  type CodexUpstreamResult
} from "../src/main/proxy/upstream-client";

describe("OAuth helpers", () => {
  it("builds authorize URLs with PKCE, state, originator, and workspace constraints", () => {
    const url = makeAuthorizeURL({
      redirectUri: "http://localhost:1455/auth/callback",
      pkce: { codeVerifier: "verifier", codeChallenge: "challenge" },
      state: "state",
      forcedWorkspaceId: "acct-1"
    });

    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("originator")).toBe("codex_cli_rs");
    expect(url.searchParams.get("allowed_workspace_id")).toBe("acct-1");
  });

  it("form-encodes token exchange bodies", () => {
    expect(
      formEncodedBody([
        ["grant_type", "authorization_code"],
        ["redirect_uri", "http://localhost:1455/auth/callback"]
      ])
    ).toBe("grant_type=authorization_code&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback");
  });

  it("keeps OAuth messages localized for every supported non-English locale", () => {
    const messageKeys = [
      "addAccountTimeout",
      "browserOpenFailed",
      "callbackFailedFormat",
      "callbackMissingCode",
      "callbackServerStartFailed",
      "callbackStateMismatch",
      "requestCancelled",
      "tokenExchangeFailedFormat",
      "workspaceMismatchFormat"
    ] satisfies OAuthMessageKey[];

    for (const locale of appLocales) {
      if (locale === "en") {
        continue;
      }
      for (const key of messageKeys) {
        const message = oauthMessage(locale, key, "workspace");
        expect(message, `${locale}.${key}`).not.toBe(oauthMessage("en", key, "workspace"));
        expect(message.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("completes callback sign-in after validating state", async () => {
    let openedURL: string | undefined;
    const fetchMock = queuedFetch([
      jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        id_token: makeJwt("acct-1", "user@example.com")
      }),
      jsonResponse({
        access_token: "api-key"
      })
    ]);
    const service = new OpenAIChatGPTOAuthLoginService(
      { codexConfigPath: "/missing-config.toml" },
      {
        fetchImpl: fetchMock.fetchImpl,
        openExternal: (url) => {
          openedURL = url;
          return true;
        },
        stateFactory: () => "state",
        pkceFactory: () => ({ codeVerifier: "verifier", codeChallenge: "challenge" })
      }
    );

    const signIn = service.signInWithChatGPT(2, "acct-1");
    const callbackURL = await callbackURLFromOpenedAuthorizeURL(() => openedURL);
    const response = await fetch(`${callbackURL}state=state&code=code`);
    const tokens = await signIn;

    expect(response.status).toBe(200);
    expect(tokens).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: makeJwt("acct-1", "user@example.com"),
      apiKey: "api-key"
    });
    expect(fetchMock.calls[0]?.body).toContain("grant_type=authorization_code");
    expect(fetchMock.calls[0]?.body).toContain("code_verifier=verifier");
  });

  it("validates forced workspace from access token claims", async () => {
    let openedURL: string | undefined;
    const accessToken = makeJwt("acct-1", "user@example.com");
    const idToken = makeJwtPayload({
      email: "user@example.com",
      sub: "user-principal"
    });
    const fetchMock = queuedFetch([
      jsonResponse({
        access_token: accessToken,
        refresh_token: "refresh-token",
        id_token: idToken
      }),
      jsonResponse({
        access_token: "api-key"
      })
    ]);
    const service = new OpenAIChatGPTOAuthLoginService(
      { codexConfigPath: "/missing-config.toml" },
      {
        fetchImpl: fetchMock.fetchImpl,
        openExternal: (url) => {
          openedURL = url;
          return true;
        },
        stateFactory: () => "state",
        pkceFactory: () => ({ codeVerifier: "verifier", codeChallenge: "challenge" })
      }
    );

    const signIn = service.signInWithChatGPT(2, "acct-1");
    const callbackURL = await callbackURLFromOpenedAuthorizeURL(() => openedURL);
    const response = await fetch(`${callbackURL}state=state&code=code`);
    const tokens = await signIn;

    expect(response.status).toBe(200);
    expect(tokens).toEqual({
      accessToken,
      refreshToken: "refresh-token",
      idToken,
      apiKey: "api-key"
    });
  });

  it("rejects callback sign-in when state does not match", async () => {
    let openedURL: string | undefined;
    const service = new OpenAIChatGPTOAuthLoginService(
      { codexConfigPath: "/missing-config.toml" },
      {
        fetchImpl: queuedFetch([]).fetchImpl,
        openExternal: (url) => {
          openedURL = url;
          return true;
        },
        stateFactory: () => "expected-state",
        pkceFactory: () => ({ codeVerifier: "verifier", codeChallenge: "challenge" })
      }
    );

    const signIn = service.signInWithChatGPT(2);
    const rejection = expect(signIn).rejects.toThrow(/callback validation failed/);
    const callbackURL = await callbackURLFromOpenedAuthorizeURL(() => openedURL);
    const response = await fetch(`${callbackURL}state=wrong-state&code=code`);

    await rejection;
    expect(response.status).toBe(400);
  });

  it("localizes browser-open failures using the current app locale", async () => {
    const service = new OpenAIChatGPTOAuthLoginService(
      { codexConfigPath: "/missing-config.toml" },
      {
        fetchImpl: queuedFetch([]).fetchImpl,
        localeProvider: () => "zh-Hans",
        openExternal: () => false,
        stateFactory: () => "state",
        pkceFactory: () => ({ codeVerifier: "verifier", codeChallenge: "challenge" })
      }
    );

    await expect(service.signInWithChatGPT(2)).rejects.toThrow("无法打开浏览器登录页");
  });

  it("localizes OAuth callback failures and callback pages", async () => {
    let openedURL: string | undefined;
    const service = new OpenAIChatGPTOAuthLoginService(
      { codexConfigPath: "/missing-config.toml" },
      {
        fetchImpl: queuedFetch([]).fetchImpl,
        localeProvider: () => "zh-Hans",
        openExternal: (url) => {
          openedURL = url;
          return true;
        },
        stateFactory: () => "expected-state",
        pkceFactory: () => ({ codeVerifier: "verifier", codeChallenge: "challenge" })
      }
    );

    const signIn = service.signInWithChatGPT(2);
    const rejection = expect(signIn).rejects.toThrow("登录回调校验失败，请重试");
    const callbackURL = await callbackURLFromOpenedAuthorizeURL(() => openedURL);
    const response = await fetch(`${callbackURL}state=wrong-state&code=code`);
    const html = await response.text();

    await rejection;
    expect(response.status).toBe(400);
    expect(html).toContain("登录回调校验失败，请重试");
  });

  it("localizes OAuth sign-in timeout errors", async () => {
    const service = new OpenAIChatGPTOAuthLoginService(
      { codexConfigPath: "/missing-config.toml" },
      {
        fetchImpl: queuedFetch([]).fetchImpl,
        localeProvider: () => "zh-Hans",
        openExternal: () => true,
        stateFactory: () => "state",
        pkceFactory: () => ({ codeVerifier: "verifier", codeChallenge: "challenge" })
      }
    );

    await expect(service.signInWithChatGPT(0)).rejects.toThrow("等待浏览器登录完成超时，请重试");
  });

  it("localizes OAuth token exchange failures", async () => {
    const service = new OpenAIChatGPTOAuthLoginService(
      { codexConfigPath: "/missing-config.toml" },
      {
        fetchImpl: queuedFetch([new Response("bad request", { status: 400 })]).fetchImpl,
        localeProvider: () => "zh-Hans"
      }
    );

    await expect(
      service.exchangeCodeForTokens(
        "code",
        "http://localhost:1455/auth/callback",
        { codeVerifier: "verifier", codeChallenge: "challenge" }
      )
    ).rejects.toThrow("登录令牌交换失败：bad request");
  });
});

describe("refresh token exchange coordinator", () => {
  it("coalesces concurrent refreshes and reuses a short-lived cache", async () => {
    let now = 1_000;
    let calls = 0;
    const tokens: ChatGPTOAuthTokens = {
      accessToken: "access",
      refreshToken: "refresh-new",
      idToken: "id"
    };
    const coordinator = new ChatGPTRefreshTokenExchangeCoordinator(60_000, 32, () => now);
    const operation = async () => {
      calls += 1;
      return tokens;
    };

    await expect(Promise.all([coordinator.refresh("refresh", operation), coordinator.refresh("refresh", operation)])).resolves.toEqual([
      tokens,
      tokens
    ]);
    await expect(coordinator.refresh("refresh", operation)).resolves.toEqual(tokens);
    expect(calls).toBe(1);

    now += 61_000;
    await coordinator.refresh("refresh", operation);
    expect(calls).toBe(2);
  });
});

describe("usage parsing", () => {
  it("sends the injected desktop platform user agent", async () => {
    const fetchMock = queuedFetch([jsonResponse({})]);
    const service = new DefaultUsageService(
      { codexConfigPath: "/missing-config.toml" },
      { fetchImpl: fetchMock.fetchImpl, userAgent: "codex-tools-macos/0.1" }
    );

    await service.fetchUsage("access-token", "acct-1");

    expect(fetchMock.calls[0]?.headers.get("User-Agent")).toBe("codex-tools-macos/0.1");
    expect(fetchMock.calls[0]?.headers.get("ChatGPT-Account-Id")).toBe("acct-1");
  });

  it("maps primary, secondary, additional windows, and credits", () => {
    const snapshot = mapUsagePayload(
      {
        plan_type: "plus",
        rate_limit: {
          primary_window: { used_percent: 40, limit_window_seconds: 5 * 60 * 60, reset_at: 123 },
          secondary_window: { used_percent: 70, limit_window_seconds: 7 * 24 * 60 * 60, reset_at: 456 }
        },
        additional_rate_limits: [
          {
            rate_limit: {
              primary_window: { used_percent: 10, limit_window_seconds: 60, reset_at: 999 }
            }
          }
        ],
        credits: {
          has_credits: true,
          unlimited: false,
          balance: "20"
        }
      },
      1_780_000_000
    );

    expect(snapshot.fetchedAt).toBe(1_780_000_000);
    expect(snapshot.planType).toBe("plus");
    expect(snapshot.fiveHour?.usedPercent).toBe(40);
    expect(snapshot.oneWeek?.usedPercent).toBe(70);
    expect(snapshot.credits).toEqual({ hasCredits: true, unlimited: false, balance: "20" });
  });
});

describe("workspace metadata parsing", () => {
  it("sends the injected desktop platform user agent", async () => {
    const fetchMock = queuedFetch([jsonResponse({ items: [] })]);
    const service = new DefaultWorkspaceMetadataService(
      { codexConfigPath: "/missing-config.toml" },
      { fetchImpl: fetchMock.fetchImpl, userAgent: "codex-tools-macos/0.1" }
    );

    await service.fetchWorkspaceMetadata("access-token");

    expect(fetchMock.calls[0]?.headers.get("User-Agent")).toBe("codex-tools-macos/0.1");
  });

  it("maps ChatGPT account items to workspace metadata", () => {
    expect(
      mapWorkspaceMetadataPayload({
        items: [
          { id: "acct-1", name: "Team", structure: "workspace" },
          { id: "acct-2", name: "Personal", structure: "personal" }
        ]
      })
    ).toEqual([
      { accountId: "acct-1", workspaceName: "Team", structure: "workspace" },
      { accountId: "acct-2", workspaceName: "Personal", structure: "personal" }
    ]);
  });
});

describe("weekly quota warmup service", () => {
  it("posts the warmup body through the Codex upstream client", async () => {
    const upstream = new FakeWarmupUpstream(sseResult({ type: "response.completed" }));
    const service = new DefaultWeeklyQuotaWarmupService(
      { codexConfigPath: "/missing-config.toml" },
      { upstreamClient: upstream }
    );

    await service.warmUp("access-token", "acct-1");

    expect(upstream.requests[0]?.url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(upstream.requests[0]?.accessToken).toBe("access-token");
    expect(upstream.requests[0]?.accountId).toBe("acct-1");
    expect(JSON.parse(upstream.requests[0]?.body.toString("utf8") ?? "{}")).toMatchObject({
      model: "gpt-5.4-mini",
      stream: true,
      store: false,
      tool_choice: "none",
      parallel_tool_calls: false,
      tools: [],
      include: [],
      reasoning: { effort: "low" },
      input: [{ type: "message", role: "user" }]
    });
  });

  it("surfaces SSE response errors from warmup calls", async () => {
    const upstream = new FakeWarmupUpstream(
      sseResult({
        type: "response.error",
        error: { message: "quota exceeded", code: "quota_exceeded" }
      })
    );
    const service = new DefaultWeeklyQuotaWarmupService(
      { codexConfigPath: "/missing-config.toml" },
      { upstreamClient: upstream }
    );

    await expect(service.warmUp("access-token", "acct-1")).rejects.toThrow(/SSE 429: quota exceeded/);
  });

  it("includes a bounded upstream body preview in HTTP warmup failures", async () => {
    const upstream = new FakeWarmupUpstream(
      new CodexUpstreamError(400, "HTTP 400", `${"x".repeat(600)}-hidden`)
    );
    const service = new DefaultWeeklyQuotaWarmupService(
      { codexConfigPath: "/missing-config.toml" },
      { upstreamClient: upstream }
    );

    await expect(service.warmUp("access-token", "acct-1")).rejects.toThrow(
      new RegExp(`HTTP 400: ${"x".repeat(512)}(?!x|-hidden)`)
    );
  });

  it("keeps the warmup body stable", () => {
    const body = JSON.parse(makeWarmupBodyBuffer().toString("utf8")) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-5.4-mini",
      stream: true,
      store: false,
      instructions: "Reply with OK.",
      tool_choice: "none",
      parallel_tool_calls: false,
      tools: [],
      include: [],
      reasoning: { effort: "low" }
    });
    expect((body.reasoning as Record<string, unknown>).summary).toBeUndefined();
  });
});

function queuedFetch(responses: Response[]) {
  const calls: Array<{ url: string; body?: string; headers: Headers }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: new Headers(init?.headers)
    });
    const response = responses.shift();
    if (!response) {
      throw new Error("No queued fetch response");
    }
    return response;
  };
  return { fetchImpl, calls };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

class FakeWarmupUpstream implements CodexUpstreamClientLike {
  public readonly requests: CodexUpstreamRequest[] = [];

  constructor(private readonly result: CodexUpstreamResult | Error) {}

  async execute(request: CodexUpstreamRequest): Promise<CodexUpstreamResult> {
    this.requests.push(request);
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

function sseResult(event: unknown): CodexUpstreamResult {
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8"
    },
    body: Buffer.from(`data: ${JSON.stringify(event)}\n\n`)
  };
}

async function callbackURLFromOpenedAuthorizeURL(readOpenedURL: () => string | undefined): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const openedURL = readOpenedURL();
    if (openedURL) {
      const authorizeURL = new URL(openedURL);
      const redirectUri = authorizeURL.searchParams.get("redirect_uri");
      if (!redirectUri) {
        throw new Error("Authorize URL did not contain redirect_uri");
      }
      return redirectUri.includes("?") ? `${redirectUri}&` : `${redirectUri}?`;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for authorize URL");
}

function makeJwt(accountId: string, email: string): string {
  return makeJwtPayload({
    email,
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId,
      chatgpt_plan_type: "plus"
    }
  });
}

function makeJwtPayload(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}
