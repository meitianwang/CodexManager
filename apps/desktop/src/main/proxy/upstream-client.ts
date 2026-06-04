import { boundedResponseText } from "../services/bounded-response";
import { appInfo } from "../../shared/app-info";

const maxResponseBytes = 50 * 1024 * 1024;
const defaultUserAgent = "codex_cli_rs/0.116.0 (Desktop) CodexManager/0.1";
const blockedForwardedHeaders = new Set([
  "authorization",
  "x-api-key",
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "accept-encoding",
  "chatgpt-account-id"
]);

export interface CodexUpstreamRequest {
  method: string;
  url: string;
  body: Buffer;
  headers: Record<string, string>;
  accessToken: string;
  accountId: string;
  isStream: boolean;
  signal?: AbortSignal;
}

export interface CodexUpstreamCompleteResult {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
  stream?: false;
}

export interface CodexUpstreamStreamingResult {
  statusCode: number;
  headers: Record<string, string>;
  body: AsyncIterable<Buffer>;
  stream: true;
}

export type CodexUpstreamResult = CodexUpstreamCompleteResult | CodexUpstreamStreamingResult;

export interface CodexUpstreamClientLike {
  execute(request: CodexUpstreamRequest): Promise<CodexUpstreamResult>;
}

export interface CodexUpstreamClientOptions {
  userAgent?: string;
}

export class CodexUpstreamError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly body: string
  ) {
    super(message);
    this.name = "CodexUpstreamError";
  }

  get isRetryable(): boolean {
    if (this.statusCode === 401 || this.statusCode === 429 || this.statusCode >= 500) {
      return true;
    }
    if (this.statusCode === 403) {
      const body = this.body.toLowerCase();
      return (
        body.includes("model_restricted") ||
        body.includes("model_not_found") ||
        body.includes("authentication") ||
        body.includes("unauthorized") ||
        body.includes("invalid_api_key")
      );
    }
    return false;
  }
}

export class CodexUpstreamClient implements CodexUpstreamClientLike {
  private readonly userAgent: string;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    options: CodexUpstreamClientOptions = {}
  ) {
    this.userAgent = options.userAgent ?? defaultUserAgent;
  }

  async execute(request: CodexUpstreamRequest): Promise<CodexUpstreamResult> {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (isForwardableHeader(name)) {
        headers.set(name, value);
      }
    }

    if (request.body.byteLength > 0 && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    headers.set("Authorization", `Bearer ${request.accessToken}`);
    headers.set("ChatGPT-Account-ID", request.accountId);
    if (!headers.has("User-Agent")) {
      headers.set("User-Agent", this.userAgent);
    }
    if (!headers.has("originator")) {
      headers.set("originator", "codex_cli_rs");
    }
    if (!headers.has("version")) {
      headers.set("version", appInfo.version);
    }
    headers.set("Accept", request.isStream ? "text/event-stream" : "application/json");

    const response = await this.fetchImpl(request.url, {
      method: request.method,
      headers,
      body: request.body.byteLength > 0 ? request.body.toString("utf8") : undefined,
      signal: request.signal
    });

    if (!response.ok) {
      const body = await boundedResponseText(response);
      throw new CodexUpstreamError(response.status, `HTTP ${response.status}`, body);
    }

    if (request.isStream && response.body) {
      return {
        statusCode: response.status,
        headers: responseHeaders(response),
        body: streamResponseBody(response),
        stream: true
      };
    }

    return {
      statusCode: response.status,
      headers: responseHeaders(response),
      body: await boundedArrayBuffer(response)
    };
  }
}

export function isStreamingUpstreamResult(result: CodexUpstreamResult): result is CodexUpstreamStreamingResult {
  return result.stream === true;
}

export function isForwardableHeader(name: string): boolean {
  return !blockedForwardedHeaders.has(name.toLowerCase());
}

function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "transfer-encoding" && key.toLowerCase() !== "content-length") {
      headers[key] = value;
    }
  });
  return headers;
}

async function boundedArrayBuffer(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    return Buffer.from(await response.arrayBuffer());
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total <= maxResponseBytes) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    total += value.byteLength;
    if (total > maxResponseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Upstream response exceeded maximum size");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function* streamResponseBody(response: Response): AsyncGenerator<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    yield Buffer.from(await response.arrayBuffer());
    return;
  }

  let total = 0;
  try {
    while (total <= maxResponseBytes) {
      const { done, value } = await reader.read();
      if (done || !value) {
        return;
      }
      total += value.byteLength;
      if (total > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Upstream response exceeded maximum size");
      }
      yield Buffer.from(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
