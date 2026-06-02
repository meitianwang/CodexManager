export interface ParsedCodexSSEEvent {
  object: Record<string, unknown>;
  rawText: string;
  type: string;
}

export interface ParsedCodexSSEError {
  body: string;
  message: string;
  statusCode: number;
}

export type CodexSSEPreflightLineResult =
  | { kind: "continue" }
  | { kind: "ready" }
  | { error: ParsedCodexSSEError; kind: "error" };

const maxPreflightBytes = 64 * 1024;
const maxPreflightLines = 128;
const maxDecodedLineBytes = 64 * 1024;

export function parseCodexSSEEvents(text: string): ParsedCodexSSEEvent[] {
  const events: ParsedCodexSSEEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const payload = line.slice("data: ".length).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (isRecord(parsed) && typeof parsed.type === "string") {
        events.push({
          object: parsed,
          rawText: payload,
          type: parsed.type
        });
      }
    } catch {
      continue;
    }
  }
  return events;
}

export function firstPreflightCodexSSEError(text: string): ParsedCodexSSEError | undefined {
  let lines = 0;
  let bytes = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.endsWith("\n") ? rawLine : `${rawLine}\n`;
    lines += 1;
    bytes += Buffer.byteLength(line);

    const event = parseCodexSSEEventLine(rawLine);
    if (event) {
      const error = codexSSEErrorFromEvent(event);
      if (error) {
        return error;
      }
      if (isReadyForClient(event)) {
        return undefined;
      }
    }

    if (lines >= maxPreflightLines || bytes >= maxPreflightBytes) {
      return undefined;
    }
  }
  return undefined;
}

export function inspectCodexSSEPreflightLine(line: string): CodexSSEPreflightLineResult {
  const event = parseCodexSSEEventLine(line);
  if (!event) {
    return { kind: "continue" };
  }
  const error = codexSSEErrorFromEvent(event);
  if (error) {
    return { kind: "error", error };
  }
  return isReadyForClient(event) ? { kind: "ready" } : { kind: "continue" };
}

export async function* parseCodexSSEEventsFromChunks(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<ParsedCodexSSEEvent> {
  for await (const line of decodeTextLines(chunks)) {
    const event = parseCodexSSEEventLine(line);
    if (event) {
      yield event;
    }
  }
}

export function codexSSEErrorFromEvent(event: ParsedCodexSSEEvent): ParsedCodexSSEError | undefined {
  let errorObject: Record<string, unknown> | undefined;
  switch (event.type) {
    case "response.error":
      errorObject = isRecord(event.object.error) ? event.object.error : undefined;
      break;
    case "response.failed": {
      const response = isRecord(event.object.response) ? event.object.response : undefined;
      errorObject = isRecord(response?.error)
        ? response.error
        : isRecord(event.object.error)
          ? event.object.error
          : undefined;
      break;
    }
    default:
      return undefined;
  }

  const message = normalizedErrorMessage(errorObject, event.type);
  return {
    body: event.rawText,
    message,
    statusCode: statusCodeForError(errorObject, message)
  };
}

export function collectCompletedResponseFromSSE(text: string): { body: unknown; statusCode: number } {
  for (const event of parseCodexSSEEvents(text)) {
    const error = codexSSEErrorFromEvent(event);
    if (error) {
      return {
        body: { error: { message: error.message, type: "proxy_error" } },
        statusCode: error.statusCode
      };
    }
    if (event.type === "response.completed" && event.object.response !== undefined) {
      return {
        body: event.object.response,
        statusCode: 200
      };
    }
  }

  return {
    body: { error: { message: "Failed to extract completed response from upstream SSE", type: "proxy_error" } },
    statusCode: 502
  };
}

function normalizedErrorMessage(errorObject: Record<string, unknown> | undefined, fallback: string): string {
  const candidates = [errorObject?.message, errorObject?.code, errorObject?.type];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return fallback;
}

function statusCodeForError(errorObject: Record<string, unknown> | undefined, message: string): number {
  if (typeof errorObject?.status === "number" && Number.isInteger(errorObject.status)) {
    return errorObject.status;
  }
  if (typeof errorObject?.status_code === "number" && Number.isInteger(errorObject.status_code)) {
    return errorObject.status_code;
  }

  const text = [message, errorObject?.code, errorObject?.type]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (text.includes("quota") || text.includes("rate") || text.includes("limit") || text.includes("too_many_requests")) {
    return 429;
  }
  if (text.includes("auth") || text.includes("unauthorized") || text.includes("invalid_api_key")) {
    return 401;
  }
  if (text.includes("model_restricted") || text.includes("model_not_found") || text.includes("permission") || text.includes("forbidden")) {
    return 403;
  }
  return 502;
}

function parseCodexSSEEventLine(line: string): ParsedCodexSSEEvent | undefined {
  if (!line.startsWith("data: ")) {
    return undefined;
  }
  const payload = line.slice("data: ".length).trim();
  if (!payload || payload === "[DONE]") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (isRecord(parsed) && typeof parsed.type === "string") {
      return {
        object: parsed,
        rawText: payload,
        type: parsed.type
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function* decodeTextLines(
  chunks: AsyncIterable<Uint8Array>,
  maxLineBytes = maxDecodedLineBytes
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = "";

  for await (const chunk of chunks) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
      assertDecodedLineWithinLimit(normalizedLine, maxLineBytes);
      yield normalizedLine;
    }
    assertDecodedLineWithinLimit(pending, maxLineBytes);
  }

  pending += decoder.decode();
  if (pending) {
    const normalizedLine = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
    assertDecodedLineWithinLimit(normalizedLine, maxLineBytes);
    yield normalizedLine;
  }
}

function assertDecodedLineWithinLimit(line: string, maxLineBytes: number): void {
  if (Buffer.byteLength(line) > maxLineBytes) {
    throw new Error(`SSE line exceeded maximum size of ${maxLineBytes} bytes`);
  }
}

function isReadyForClient(event: ParsedCodexSSEEvent): boolean {
  switch (event.type) {
    case "response.output_text.delta":
    case "response.reasoning_summary_text.delta":
    case "response.output_item.added":
    case "response.function_call_arguments.delta":
    case "response.completed":
      return true;
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
