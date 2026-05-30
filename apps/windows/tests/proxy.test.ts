import { afterEach, describe, expect, it } from "vitest";
import type { AccountsStore } from "../src/shared/models/accounts";
import type { AppSettings } from "../src/shared/models/settings";
import { defaultAppSettings } from "../src/shared/models/settings";
import type { JSONValue } from "../src/shared/models/json-value";
import type { ChatGPTOAuthTokens, ExtractedAuth } from "../src/shared/models/auth";
import type { AccountsStoreRepositoryLike, AuthRepositoryLike } from "../src/main/services/accounts-coordinator";
import { ProxyCoordinator, type SettingsRepositoryLike } from "../src/main/proxy/proxy-coordinator";
import {
  CodexUpstreamError,
  type CodexUpstreamClientLike,
  type CodexUpstreamRequest,
  type CodexUpstreamResult
} from "../src/main/proxy/upstream-client";

const running: ProxyCoordinator[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((proxy) => proxy.stop()));
});

describe("local proxy", () => {
  it("serves health without API key", async () => {
    const context = await makeProxyContext();
    const response = await fetch(`http://127.0.0.1:${context.port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects non-health requests without the configured API key", async () => {
    const context = await makeProxyContext();
    const response = await fetch(`http://127.0.0.1:${context.port}/v1/responses`, {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5-codex", input: [] })
    });

    expect(response.status).toBe(401);
  });

  it("forwards Responses requests through the selected account and cleans headers", async () => {
    const upstream = new FakeUpstreamClient([
      successResult({ id: "resp-1" }, { "x-codex-turn-state": "next", "transfer-encoding": "chunked" })
    ]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/responses", {
      model: "gpt-5-codex",
      stream: false,
      input: []
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-codex-turn-state")).toBe("next");
    expect(response.headers.get("transfer-encoding")).not.toBe("chunked");
    expect(upstream.requests[0]?.accountId).toBe("acct-1");
    expect(upstream.requests[0]?.accessToken).toBe("access-1");
    expect(upstream.requests[0]?.headers["x-api-key"]).toBeUndefined();
    expect(JSON.parse(upstream.requests[0]?.body.toString("utf8") ?? "{}")).toMatchObject({
      model: "gpt-5-codex",
      stream: true
    });
  });

  it("translates non-streaming Chat Completions requests", async () => {
    const upstream = new FakeUpstreamClient([sseResult("Hello")]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/chat/completions", {
      model: "gpt-5-codex",
      stream: false,
      reasoning_effort: "high",
      messages: [
        { role: "system", content: "Stay terse" },
        { role: "user", content: "Hi" }
      ]
    });
    const body = (await response.json()) as Record<string, unknown>;
    const forwarded = JSON.parse(upstream.requests[0]?.body.toString("utf8") ?? "{}") as Record<string, unknown>;

    expect(body.choices).toMatchObject([
      {
        message: {
          role: "assistant",
          content: "Hello"
        }
      }
    ]);
    expect(forwarded.instructions).toBe("Stay terse");
    expect(forwarded.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(forwarded.stream).toBe(true);
  });

  it("translates Anthropic messages requests to Codex Responses", async () => {
    const upstream = new FakeUpstreamClient([sseResult("Hello")]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/messages", {
      model: "gpt-5-codex",
      stream: true,
      system: "You are concise",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      thinking: { type: "disabled" },
      tools: [{ name: "lookup", description: "Lookup", input_schema: { type: "object", $schema: "draft" } }]
    });
    const forwarded = JSON.parse(upstream.requests[0]?.body.toString("utf8") ?? "{}") as Record<string, unknown>;
    const tools = forwarded.tools as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(forwarded.reasoning).toEqual({ effort: "low", summary: "auto" });
    expect(JSON.stringify(forwarded.input)).toContain("You are concise");
    expect(tools[0]?.parameters).toEqual({ type: "object" });
  });

  it("retries the next eligible account after a retryable upstream error", async () => {
    const upstream = new FakeUpstreamClient([
      new CodexUpstreamError(429, "HTTP 429", "quota"),
      successResult({ id: "resp-2" })
    ]);
    const context = await makeProxyContext({
      upstream,
      store: {
        version: 1,
        accounts: [
          makeAccount("a", "acct-a", "access-a", 1),
          makeAccount("b", "acct-b", "access-b", 2)
        ]
      }
    });

    const response = await authorizedFetch(context.port, "/v1/responses", {
      model: "gpt-5-codex",
      input: []
    });

    expect(response.status).toBe(200);
    expect(upstream.requests.map((request) => request.accountId)).toEqual(["acct-a", "acct-b"]);
  });

  it("refreshes an expired access token and retries the same account before moving on", async () => {
    const upstream = new FakeUpstreamClient([
      new CodexUpstreamError(401, "HTTP 401", "authentication failed"),
      successResult({ id: "resp-refreshed" })
    ]);
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [makeAccount("a", "acct-a", "expired-access", 1, "refresh-a")]
    });
    const authRepository = new FakeAuthRepository(fakeAuth("acct-a", "expired-access", "a@example.com", "refresh-a"));
    const context = await makeProxyContext({
      upstream,
      storeRepository,
      authRepository,
      refreshService: new FakeRefreshTokenService({
        accessToken: "fresh-access",
        refreshToken: "refresh-new",
        idToken: "id-new"
      })
    });

    const response = await authorizedFetch(context.port, "/v1/responses", {
      model: "gpt-5-codex",
      input: []
    });

    expect(response.status).toBe(200);
    expect(upstream.requests.map((request) => request.accessToken)).toEqual(["expired-access", "fresh-access"]);
    expect(storeRepository.store.accounts[0]?.authJson).toMatchObject({
      accessToken: "fresh-access"
    });
    expect(authRepository.currentAuth).toMatchObject({
      accessToken: "fresh-access"
    });
  });

  it("cools down a rate-limited account on later requests", async () => {
    const upstream = new FakeUpstreamClient([
      new CodexUpstreamError(429, "HTTP 429", "rate limit"),
      successResult({ id: "resp-b" }),
      successResult({ id: "resp-b-again" })
    ]);
    const context = await makeProxyContext({
      upstream,
      store: {
        version: 1,
        accounts: [
          makeAccount("a", "acct-a", "access-a", 1),
          makeAccount("b", "acct-b", "access-b", 2)
        ]
      }
    });

    const first = await authorizedFetch(context.port, "/v1/responses", {
      model: "gpt-5-codex",
      input: []
    });
    const second = await authorizedFetch(context.port, "/v1/responses", {
      model: "gpt-5-codex",
      input: []
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(upstream.requests.map((request) => request.accountId)).toEqual(["acct-a", "acct-b", "acct-b"]);
  });

  it("skips accounts whose plan does not support the requested catalog model", async () => {
    const upstream = new FakeUpstreamClient([successResult({ id: "resp-pro" })]);
    const context = await makeProxyContext({
      modelCatalogService: new FakeModelCatalogService({
        "codex-plus": ["plus-model"],
        "codex-pro": ["pro-model"]
      }),
      store: {
        version: 1,
        accounts: [
          makeAccount("plus", "acct-plus", "access-plus", 1, "refresh-plus", "plus"),
          makeAccount("pro", "acct-pro", "access-pro", 2, "refresh-pro", "pro")
        ]
      },
      upstream
    });

    const response = await authorizedFetch(context.port, "/v1/responses", {
      model: "pro-model",
      input: []
    });

    expect(response.status).toBe(200);
    expect(upstream.requests.map((request) => request.accountId)).toEqual(["acct-pro"]);
  });
});

async function makeProxyContext(options: {
  store?: AccountsStore;
  storeRepository?: MemoryStoreRepository;
  settings?: AppSettings;
  upstream?: FakeUpstreamClient;
  authRepository?: FakeAuthRepository;
  refreshService?: FakeRefreshTokenService;
  modelCatalogService?: FakeModelCatalogService;
} = {}) {
  const store = options.store ?? {
    version: 1,
    accounts: [makeAccount("one", "acct-1", "access-1", 1)]
  };
  const storeRepository = options.storeRepository ?? new MemoryStoreRepository(store);
  const upstream = options.upstream ?? new FakeUpstreamClient([successResult({ id: "resp-default" })]);
  const proxy = new ProxyCoordinator({
    storeRepository,
    settingsRepository: new StaticSettingsRepository(options.settings ?? { ...defaultAppSettings(), proxyApiKey: "test-key", proxyPort: 0 }),
    authRepository: options.authRepository ?? new FakeAuthRepository(),
    codexConfigPath: "/missing-config.toml",
    chatGPTOAuthLoginService: options.refreshService,
    modelCatalogService: options.modelCatalogService,
    upstreamClient: upstream,
    dateProvider: { unixSecondsNow: () => 1_780_000_000 }
  });
  const port = await proxy.start(0);
  running.push(proxy);
  return { proxy, port, upstream };
}

async function authorizedFetch(port: number, path: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "test-key",
      "ChatGPT-Account-ID": "client-account"
    },
    body: JSON.stringify(body)
  });
}

class MemoryStoreRepository implements AccountsStoreRepositoryLike {
  constructor(public store: AccountsStore) {}

  async loadStore(): Promise<AccountsStore> {
    return structuredClone(this.store);
  }

  async saveStore(store: AccountsStore): Promise<void> {
    this.store = structuredClone(store);
  }
}

class StaticSettingsRepository implements SettingsRepositoryLike {
  constructor(private readonly settings: AppSettings) {}

  async loadSettings(): Promise<AppSettings> {
    return this.settings;
  }
}

class FakeAuthRepository implements AuthRepositoryLike {
  public currentAuth: JSONValue | undefined;

  constructor(currentAuth?: JSONValue) {
    this.currentAuth = currentAuth;
  }

  async readCurrentAuth(): Promise<JSONValue> {
    if (!this.currentAuth) {
      throw new Error("missing current auth");
    }
    return this.currentAuth;
  }

  async readCurrentAuthOptional(): Promise<JSONValue | undefined> {
    return this.currentAuth;
  }

  async readAuth(): Promise<JSONValue> {
    throw new Error("not implemented");
  }

  async writeCurrentAuth(auth: JSONValue): Promise<void> {
    this.currentAuth = auth;
  }

  makeChatGPTAuth(tokens: ChatGPTOAuthTokens): JSONValue {
    return fakeAuth("acct", tokens.accessToken);
  }

  replacingChatGPTTokens(auth: JSONValue, tokens: ChatGPTOAuthTokens): JSONValue {
    const object = auth as Record<string, JSONValue>;
    const tokensObject = typeof object.tokens === "object" && object.tokens !== null && !Array.isArray(object.tokens)
      ? (object.tokens as Record<string, JSONValue>)
      : {};
    return {
      ...object,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokens: {
        ...tokensObject,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        id_token: tokens.idToken
      }
    };
  }

  extractAuth(auth: JSONValue): ExtractedAuth {
    const object = auth as Record<string, JSONValue>;
    const tokens = typeof object.tokens === "object" && object.tokens !== null && !Array.isArray(object.tokens)
      ? (object.tokens as Record<string, JSONValue>)
      : {};
    return {
      accountId: String(object.accountId ?? tokens.account_id),
      accessToken: String(object.accessToken ?? tokens.access_token),
      email: typeof object.email === "string" ? object.email : undefined,
      planType: "plus",
      principalId: typeof object.email === "string" ? object.email : undefined
    };
  }
}

class FakeRefreshTokenService {
  constructor(private readonly tokens: ChatGPTOAuthTokens) {}

  async refreshChatGPTTokens(): Promise<ChatGPTOAuthTokens> {
    return this.tokens;
  }
}

class FakeUpstreamClient implements CodexUpstreamClientLike {
  public readonly requests: CodexUpstreamRequest[] = [];

  constructor(private readonly results: Array<CodexUpstreamResult | CodexUpstreamError>) {}

  async execute(request: CodexUpstreamRequest): Promise<CodexUpstreamResult> {
    this.requests.push(request);
    const result = this.results.shift();
    if (!result) {
      throw new Error("No queued upstream result");
    }
    if (result instanceof CodexUpstreamError) {
      throw result;
    }
    return result;
  }
}

class FakeModelCatalogService {
  private readonly modelsByPlanKey: Map<string, Set<string>>;

  constructor(values: Record<string, readonly string[]>) {
    this.modelsByPlanKey = new Map(
      Object.entries(values).map(([planKey, models]) => [planKey, new Set(models)])
    );
  }

  cachedModelIDsByPlanKey(): ReadonlyMap<string, ReadonlySet<string>> {
    return this.modelsByPlanKey;
  }
}

function makeAccount(id: string, accountId: string, accessToken: string, addedAt: number, refreshToken = `refresh-${id}`, planType = "plus") {
  return {
    id,
    label: id,
    email: `${id}@example.com`,
    accountId,
    planType,
    authJson: fakeAuth(accountId, accessToken, `${id}@example.com`, refreshToken),
    addedAt,
    updatedAt: addedAt,
    usage: {
      fetchedAt: 1,
      fiveHour: { usedPercent: 10, windowSeconds: 5 * 60 * 60 },
      oneWeek: { usedPercent: 10, windowSeconds: 7 * 24 * 60 * 60 }
    },
    principalId: `${id}@example.com`
  };
}

function fakeAuth(accountId: string, accessToken: string, email = "one@example.com", refreshToken = "refresh-token"): JSONValue {
  return {
    accountId,
    accessToken,
    refreshToken,
    email,
    tokens: {
      account_id: accountId,
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: `id-${accountId}`
    }
  };
}

function successResult(body: unknown, headers: Record<string, string> = {}): CodexUpstreamResult {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    },
    body: Buffer.from(JSON.stringify(body))
  };
}

function sseResult(text: string): CodexUpstreamResult {
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8"
    },
    body: Buffer.from(
      [
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}`,
        "",
        `data: ${JSON.stringify({ type: "response.completed", response: { usage: { output_tokens: 1 } } })}`,
        "",
        ""
      ].join("\n")
    )
  };
}
