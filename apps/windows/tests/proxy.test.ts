import { afterEach, describe, expect, it } from "vitest";
import type { AccountsStore } from "../src/shared/models/accounts";
import type { AppSettings } from "../src/shared/models/settings";
import { appInfo } from "../src/shared/app-info";
import { defaultAppSettings } from "../src/shared/models/settings";
import type { JSONValue } from "../src/shared/models/json-value";
import type { ChatGPTOAuthTokens, ExtractedAuth } from "../src/shared/models/auth";
import type { AccountsStoreRepositoryLike, AuthRepositoryLike } from "../src/main/services/accounts-coordinator";
import { ProxyCoordinator, type SettingsRepositoryLike } from "../src/main/proxy/proxy-coordinator";
import {
  CodexUpstreamClient,
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

  it("mirrors mac-compatible CORS headers for preflight requests", async () => {
    const context = await makeProxyContext();
    const response = await fetch(`http://127.0.0.1:${context.port}/v1/responses`, {
      method: "OPTIONS"
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(response.headers.get("access-control-max-age")).toBe("86400");
    expect(response.headers.get("access-control-allow-headers")).toContain("anthropic-version");
    expect(response.headers.get("access-control-allow-headers")).toContain("x-codex-turn-state");
    expect(response.headers.get("access-control-allow-headers")).toContain("originator");
    expect(response.headers.get("access-control-allow-headers")).toContain("version");
    expect(response.headers.get("access-control-expose-headers")).toContain("x-codex-turn-state");
    expect(response.headers.get("access-control-expose-headers")).toContain("x-models-etag");
    expect(response.headers.get("access-control-expose-headers")).toContain("x-codex-ratelimit-limit-tokens");
  });

  it("forwards Responses requests through the selected account and cleans headers", async () => {
    const upstream = new FakeUpstreamClient([
      completedResponseResult({ id: "resp-1" }, { "x-codex-turn-state": "next", "transfer-encoding": "chunked" })
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
    await expect(response.json()).resolves.toMatchObject({ id: "resp-1" });
    expect(upstream.requests[0]?.accountId).toBe("acct-1");
    expect(upstream.requests[0]?.accessToken).toBe("access-1");
    expect(upstream.requests[0]?.headers["x-api-key"]).toBeUndefined();
    expect(JSON.parse(upstream.requests[0]?.body.toString("utf8") ?? "{}")).toMatchObject({
      model: "gpt-5-codex",
      stream: true,
      store: false,
      instructions: "",
      tools: [],
      tool_choice: "auto",
      parallel_tool_calls: true,
      include: []
    });
  });

  it("adds encrypted reasoning include for Responses requests that use reasoning", async () => {
    const upstream = new FakeUpstreamClient([completedResponseResult({ id: "resp-reasoning" })]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/responses", {
      model: "gpt-5-codex",
      stream: true,
      reasoning: { effort: "high" },
      input: []
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(upstream.requests[0]?.body.toString("utf8") ?? "{}")).toMatchObject({
      stream: true,
      include: ["reasoning.encrypted_content"]
    });
  });

  it("preserves explicit Responses compatibility fields", async () => {
    const upstream = new FakeUpstreamClient([completedResponseResult({ id: "resp-explicit" })]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/responses", {
      model: "gpt-5-codex",
      stream: false,
      store: true,
      instructions: "custom",
      tools: [{ type: "web_search_preview" }],
      tool_choice: "none",
      parallel_tool_calls: false,
      include: ["file_search_call.results"],
      input: []
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(upstream.requests[0]?.body.toString("utf8") ?? "{}")).toMatchObject({
      stream: true,
      store: true,
      instructions: "custom",
      tools: [{ type: "web_search_preview" }],
      tool_choice: "none",
      parallel_tool_calls: false,
      include: ["file_search_call.results"]
    });
  });

  it("forwards Models requests as non-streaming GET with query parameters", async () => {
    const upstream = new FakeUpstreamClient([successResult({ data: [] })]);
    const context = await makeProxyContext({ upstream });

    const response = await fetch(`http://127.0.0.1:${context.port}/v1/models?limit=20`, {
      headers: {
        "x-api-key": "test-key"
      }
    });

    expect(response.status).toBe(200);
    expect(upstream.requests[0]).toMatchObject({
      method: "GET",
      isStream: false
    });
    expect(upstream.requests[0]?.url).toBe(`https://chatgpt.com/backend-api/codex/models?limit=20&client_version=${appInfo.version}`);
    expect(upstream.requests[0]?.body.byteLength).toBe(0);
  });

  it("preserves explicit Models client_version query parameters", async () => {
    const upstream = new FakeUpstreamClient([successResult({ data: [] })]);
    const context = await makeProxyContext({ upstream });

    const response = await fetch(`http://127.0.0.1:${context.port}/v1/models?client_version=1.2.3`, {
      headers: {
        version: "9.9.9",
        "x-api-key": "test-key"
      }
    });

    expect(response.status).toBe(200);
    expect(upstream.requests[0]?.url).toBe("https://chatgpt.com/backend-api/codex/models?client_version=1.2.3");
  });

  it("uses the client version header for Models requests without client_version", async () => {
    const upstream = new FakeUpstreamClient([successResult({ data: [] })]);
    const context = await makeProxyContext({ upstream });

    const response = await fetch(`http://127.0.0.1:${context.port}/v1/models`, {
      headers: {
        version: "9.9.9",
        "x-api-key": "test-key"
      }
    });

    expect(response.status).toBe(200);
    expect(upstream.requests[0]?.url).toBe("https://chatgpt.com/backend-api/codex/models?client_version=9.9.9");
  });

  it("preserves Codex JSON passthrough requests without forcing streaming", async () => {
    const upstream = new FakeUpstreamClient([successResult({ compacted: true })]);
    const context = await makeProxyContext({ upstream });
    const requestBody = {
      model: "gpt-5-codex",
      stream: false,
      input: [{ role: "user", content: "compact this" }]
    };

    const response = await authorizedFetch(context.port, "/v1/responses/compact", requestBody);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ compacted: true });
    expect(upstream.requests[0]).toMatchObject({
      isStream: false,
      url: "https://chatgpt.com/backend-api/codex/responses/compact"
    });
    expect(JSON.parse(upstream.requests[0]?.body.toString("utf8") ?? "{}")).toEqual(requestBody);
  });

  it("uses an empty default model for alpha search passthrough", async () => {
    const upstream = new FakeUpstreamClient([successResult({ results: [] })]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/alpha/search", { query: "codex" });

    expect(response.status).toBe(200);
    expect(upstream.requests[0]).toMatchObject({
      isStream: false,
      url: "https://chatgpt.com/backend-api/codex/alpha/search"
    });
    expect(upstream.requests[0]?.body.toString("utf8")).toBe(JSON.stringify({ query: "codex" }));
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

  it("defaults Chat Completions requests to non-streaming responses", async () => {
    const upstream = new FakeUpstreamClient([sseResult("Hello")]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/chat/completions", {
      model: "gpt-5-codex",
      messages: [{ role: "user", content: "Hi" }]
    });
    const body = await response.json();
    const forwarded = JSON.parse(upstream.requests[0]?.body.toString("utf8") ?? "{}") as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toMatchObject({
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: "Hello" } }]
    });
    expect(forwarded.stream).toBe(true);
  });

  it("rejects Chat Completions requests without a model before forwarding", async () => {
    const upstream = new FakeUpstreamClient([]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/chat/completions", {
      messages: [{ role: "user", content: "Hi" }]
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        message: "Missing required field: model",
        type: "proxy_error"
      }
    });
    expect(upstream.requests).toEqual([]);
  });

  it("rejects Chat Completions requests without messages before forwarding", async () => {
    const upstream = new FakeUpstreamClient([]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/chat/completions", {
      model: "gpt-5-codex"
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        message: "Chat request missing messages array",
        type: "proxy_error"
      }
    });
    expect(upstream.requests).toEqual([]);
  });

  it("translates streaming Chat Completions responses to OpenAI chunks", async () => {
    const upstream = new FakeUpstreamClient([sseResult("Hello")]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/chat/completions", {
      model: "gpt-5-codex",
      stream: true,
      messages: [{ role: "user", content: "Hi" }]
    });
    const events = parseDataEvents(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(events.at(-1)).toBe("[DONE]");
    expect(events[0]).toMatchObject({
      object: "chat.completion.chunk",
      choices: [{ delta: { role: "assistant" }, finish_reason: null }]
    });
    expect(events[1]).toMatchObject({
      object: "chat.completion.chunk",
      choices: [{ delta: { content: "Hello" }, finish_reason: null }]
    });
    expect(events[2]).toMatchObject({
      choices: [{ delta: {}, finish_reason: "stop" }]
    });
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
    const events = parseNamedEvents(await response.text());

    expect(response.status).toBe(200);
    expect(forwarded.reasoning).toEqual({ effort: "low", summary: "auto" });
    expect(JSON.stringify(forwarded.input)).toContain("You are concise");
    expect(tools[0]?.parameters).toEqual({ type: "object" });
    expect(events.map((event) => event.event)).toContain("message_start");
    expect(events).toContainEqual(expect.objectContaining({
      event: "content_block_delta",
      data: expect.objectContaining({
        delta: { type: "text_delta", text: "Hello" }
      })
    }));
    expect(events.at(-1)).toMatchObject({ event: "message_stop" });
  });

  it("translates non-streaming Anthropic responses to Anthropic message JSON", async () => {
    const upstream = new FakeUpstreamClient([
      completedResponseResult({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Hello" }]
          }
        ],
        usage: { input_tokens: 3, output_tokens: 2 }
      })
    ]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/messages", {
      model: "gpt-5-codex",
      stream: false,
      messages: [{ role: "user", content: "Hi" }]
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      type: "message",
      role: "assistant",
      model: "gpt-5-codex",
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 2 },
      content: [{ type: "text", text: "Hello" }]
    });
  });

  it("converts Anthropic tool calls and tool results in request history", async () => {
    const upstream = new FakeUpstreamClient([sseResult("Done")]);
    const context = await makeProxyContext({ upstream });

    const response = await authorizedFetch(context.port, "/v1/messages", {
      model: "gpt-5-codex",
      stream: true,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will look it up." },
            { type: "tool_use", id: "toolu_1", name: "lookup", input: { query: "codex" } }
          ]
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "result text" }] }
          ]
        }
      ]
    });
    const forwarded = JSON.parse(upstream.requests[0]?.body.toString("utf8") ?? "{}") as { input?: unknown[] };

    expect(response.status).toBe(200);
    expect(forwarded.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call", call_id: "toolu_1", name: "lookup", arguments: "{\"query\":\"codex\"}" }),
      expect.objectContaining({ type: "function_call_output", call_id: "toolu_1", output: "result text" })
    ]));
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

  it("retries the next eligible account after a 403 auth failure without a refresh token", async () => {
    const upstream = new FakeUpstreamClient([
      new CodexUpstreamError(403, "HTTP 403", "invalid_api_key"),
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

  it("retries the next eligible account after a preflight SSE error before output", async () => {
    const upstream = new FakeUpstreamClient([
      sseErrorResult({ code: "model_restricted", message: "model is not available", status: 403 }),
      sseResult("Recovered"),
      sseResult("Again")
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

    const first = await authorizedFetch(context.port, "/v1/chat/completions", {
      model: "gpt-5-codex",
      stream: false,
      messages: [{ role: "user", content: "Hi" }]
    });
    const second = await authorizedFetch(context.port, "/v1/chat/completions", {
      model: "gpt-5-codex",
      stream: false,
      messages: [{ role: "user", content: "Hi again" }]
    });

    await expect(first.json()).resolves.toMatchObject({
      choices: [{ message: { content: "Recovered" } }]
    });
    await expect(second.json()).resolves.toMatchObject({
      choices: [{ message: { content: "Again" } }]
    });
    expect(upstream.requests.map((request) => request.accountId)).toEqual(["acct-a", "acct-b", "acct-b"]);
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

  it("uses the mac-compatible short cooldown for exhausted accounts with unknown reset time", async () => {
    let now = 1_780_000_000;
    const accountA = makeAccount("a", "acct-a", "access-a", 1);
    const accountB = makeAccount("b", "acct-b", "access-b", 2);
    accountA.usage = {
      fetchedAt: 1,
      fiveHour: { usedPercent: 100, windowSeconds: 5 * 60 * 60 },
      oneWeek: { usedPercent: 0, windowSeconds: 7 * 24 * 60 * 60 }
    };
    accountB.usage = {
      fetchedAt: 1,
      fiveHour: { usedPercent: 50, windowSeconds: 5 * 60 * 60 },
      oneWeek: { usedPercent: 50, windowSeconds: 7 * 24 * 60 * 60 }
    };
    const storeRepository = new MemoryStoreRepository({
      version: 1,
      accounts: [accountA, accountB]
    });
    const upstream = new FakeUpstreamClient([
      successResult({ id: "resp-b-first" }),
      successResult({ id: "resp-b-second" }),
      successResult({ id: "resp-a" })
    ]);
    const context = await makeProxyContext({
      upstream,
      storeRepository,
      dateProvider: { unixSecondsNow: () => now }
    });

    const first = await authorizedFetch(context.port, "/v1/responses", {
      model: "gpt-5-codex",
      input: []
    });
    storeRepository.store.accounts[0] = {
      ...accountA,
      usage: {
        fetchedAt: 2,
        fiveHour: { usedPercent: 0, windowSeconds: 5 * 60 * 60 },
        oneWeek: { usedPercent: 0, windowSeconds: 7 * 24 * 60 * 60 }
      }
    };
    now += 14;
    const second = await authorizedFetch(context.port, "/v1/responses", {
      model: "gpt-5-codex",
      input: []
    });
    now += 1;
    const third = await authorizedFetch(context.port, "/v1/responses", {
      model: "gpt-5-codex",
      input: []
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(upstream.requests.map((request) => request.accountId)).toEqual(["acct-b", "acct-b", "acct-a"]);
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

describe("Codex upstream client", () => {
  it("adds the app version header when callers do not provide one", async () => {
    let sentHeaders: Headers | undefined;
    const client = new CodexUpstreamClient(async (_input, init) => {
      sentHeaders = init?.headers instanceof Headers ? init.headers : undefined;
      return jsonResponse({ ok: true });
    });

    await client.execute({
      accessToken: "access",
      accountId: "acct-1",
      body: Buffer.alloc(0),
      headers: {},
      isStream: false,
      method: "GET",
      url: "https://chatgpt.com/backend-api/codex/models"
    });

    expect(sentHeaders?.get("version")).toBe(appInfo.version);
  });

  it("preserves a caller-provided version header", async () => {
    let sentHeaders: Headers | undefined;
    const client = new CodexUpstreamClient(async (_input, init) => {
      sentHeaders = init?.headers instanceof Headers ? init.headers : undefined;
      return jsonResponse({ ok: true });
    });

    await client.execute({
      accessToken: "access",
      accountId: "acct-1",
      body: Buffer.alloc(0),
      headers: { version: "9.9.9" },
      isStream: false,
      method: "GET",
      url: "https://chatgpt.com/backend-api/codex/models"
    });

    expect(sentHeaders?.get("version")).toBe("9.9.9");
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
  dateProvider?: { unixSecondsNow(): number };
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
    dateProvider: options.dateProvider ?? { unixSecondsNow: () => 1_780_000_000 }
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
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

function sseErrorResult(error: { code: string; message: string; status: number }): CodexUpstreamResult {
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8"
    },
    body: Buffer.from(
      [
        `data: ${JSON.stringify({ type: "response.failed", response: { error } })}`,
        "",
        ""
      ].join("\n")
    )
  };
}

function completedResponseResult(response: Record<string, unknown>, headers: Record<string, string> = {}): CodexUpstreamResult {
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      ...headers
    },
    body: Buffer.from(
      [
        `data: ${JSON.stringify({ type: "response.completed", response })}`,
        "",
        ""
      ].join("\n")
    )
  };
}

function parseDataEvents(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => {
      const payload = line.slice("data: ".length).trim();
      return payload === "[DONE]" ? payload : JSON.parse(payload) as unknown;
    });
}

function parseNamedEvents(text: string): Array<{ event: string; data: unknown }> {
  const chunks = text.split(/\n\n/).filter((chunk) => chunk.trim().length > 0);
  return chunks.map((chunk) => {
    const eventLine = chunk.split(/\r?\n/).find((line) => line.startsWith("event: "));
    const dataLine = chunk.split(/\r?\n/).find((line) => line.startsWith("data: "));
    return {
      event: eventLine?.slice("event: ".length).trim() ?? "",
      data: dataLine ? JSON.parse(dataLine.slice("data: ".length)) as unknown : undefined
    };
  });
}
