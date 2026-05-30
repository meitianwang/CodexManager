import type { FileSystemPaths } from "../repositories/file-system-paths";
import { EndpointPreferenceStore } from "./endpoint-request-coordinator";
import { NetworkRequestError } from "./network-errors";
import { removeSuffix, resolveChatGPTBaseOrigin } from "./chatgpt-base-origin";
import { CodexUpstreamClient, type CodexUpstreamClientLike, type CodexUpstreamResult } from "../proxy/upstream-client";

const scope = "weekly-quota-warmup";
const warmupModel = "gpt-5";

export interface WeeklyQuotaWarmupServiceOptions {
  endpointPreferenceStore?: EndpointPreferenceStore;
  upstreamClient?: CodexUpstreamClientLike;
}

export class DefaultWeeklyQuotaWarmupService {
  private readonly endpointPreferenceStore: EndpointPreferenceStore;
  private readonly upstreamClient: CodexUpstreamClientLike;

  constructor(
    private readonly paths: Pick<FileSystemPaths, "codexConfigPath">,
    options: WeeklyQuotaWarmupServiceOptions = {}
  ) {
    this.endpointPreferenceStore = options.endpointPreferenceStore ?? new EndpointPreferenceStore();
    this.upstreamClient = options.upstreamClient ?? new CodexUpstreamClient();
  }

  async warmUp(accessToken: string, accountId: string): Promise<void> {
    const body = makeWarmupBodyBuffer();
    const failures: string[] = [];
    for (const endpoint of this.endpointPreferenceStore.prioritizedCandidates(scope, await this.resolveWarmupURLs())) {
      if (!isValidURL(endpoint)) {
        failures.push(`${endpoint} -> invalid URL`);
        continue;
      }

      try {
        const result = await this.upstreamClient.execute({
          method: "POST",
          url: endpoint,
          body,
          headers: {},
          accessToken,
          accountId,
          isStream: true
        });
        inspectWarmupResponse(result);
        this.endpointPreferenceStore.recordSuccess(scope, endpoint);
        return;
      } catch (error) {
        failures.push(`${endpoint} -> ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new NetworkRequestError(`Weekly quota warmup request failed: ${endpointFailureMessage(failures)}`);
  }

  async resolveWarmupURLs(): Promise<string[]> {
    const baseOrigin = await resolveChatGPTBaseOrigin(this.paths.codexConfigPath);
    const backendPrefix = "/backend-api";
    const codexResponsesPath = "/codex/responses";
    const backendCodexResponsesPath = "/backend-api/codex/responses";
    const originWithoutBackend = removeSuffix(baseOrigin, backendPrefix);
    const candidates = originWithoutBackend
      ? [`${baseOrigin}${codexResponsesPath}`, `${originWithoutBackend}${backendCodexResponsesPath}`]
      : [`${baseOrigin}${backendCodexResponsesPath}`];
    return dedupe([...candidates, "https://chatgpt.com/backend-api/codex/responses"]);
  }
}

export function makeWarmupBodyBuffer(): Buffer {
  return Buffer.from(
    JSON.stringify({
      model: warmupModel,
      stream: true,
      store: false,
      instructions: "Reply with OK.",
      tools: [],
      tool_choice: "auto",
      parallel_tool_calls: false,
      include: [],
      reasoning: {
        effort: "low",
        summary: "auto"
      },
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "ping"
            }
          ]
        }
      ]
    })
  );
}

function inspectWarmupResponse(result: CodexUpstreamResult): void {
  for (const line of result.body.toString("utf8").split("\n")) {
    const error = sseError(line);
    if (error) {
      throw new NetworkRequestError(`SSE ${error.statusCode}: ${error.message}`);
    }
  }
}

function sseError(line: string): { statusCode: number; message: string } | undefined {
  const event = sseEvent(line);
  if (!event) {
    return undefined;
  }

  let errorObject: Record<string, unknown> | undefined;
  if (event.type === "response.error") {
    errorObject = asOptionalRecord(event.object.error);
  } else if (event.type === "response.failed") {
    errorObject = asOptionalRecord(asOptionalRecord(event.object.response)?.error) ?? asOptionalRecord(event.object.error);
  }
  if (!errorObject) {
    return undefined;
  }

  const message = normalizedErrorMessage(errorObject, event.type);
  return {
    message,
    statusCode: statusCode(errorObject, message)
  };
}

function sseEvent(line: string): { type: string; object: Record<string, unknown> } | undefined {
  const prefix = "data: ";
  if (!line.startsWith(prefix)) {
    return undefined;
  }
  const text = line.slice(prefix.length).trim();
  if (!text) {
    return undefined;
  }

  try {
    const object = JSON.parse(text) as unknown;
    if (!isRecord(object) || typeof object.type !== "string") {
      return undefined;
    }
    return { type: object.type, object };
  } catch {
    return undefined;
  }
}

function normalizedErrorMessage(errorObject: Record<string, unknown>, fallback: string): string {
  for (const candidate of [errorObject.message, errorObject.code, errorObject.type]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return fallback;
}

function statusCode(errorObject: Record<string, unknown>, message: string): number {
  if (typeof errorObject.status === "number" && Number.isInteger(errorObject.status)) {
    return errorObject.status;
  }
  if (typeof errorObject.status_code === "number" && Number.isInteger(errorObject.status_code)) {
    return errorObject.status_code;
  }

  const text = [message, errorObject.code, errorObject.type]
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

function endpointFailureMessage(failures: readonly string[]): string {
  const preview = failures.slice(0, 2).join(" | ");
  return failures.length > 2 ? `${preview} | +${failures.length - 2} more` : preview;
}

function dedupe(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (!result.includes(value)) {
      result.push(value);
    }
  }
  return result;
}

function isValidURL(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}
