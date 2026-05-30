import type { UsageSnapshot, UsageWindow, CreditSnapshot } from "../../shared/models/usage";
import { pickNearestWindow, type UsageWindowRaw } from "../../shared/domain/usage-window-selector";
import type { FileSystemPaths } from "../repositories/file-system-paths";
import { EndpointRequestCoordinator, EndpointRequestError, EndpointPreferenceStore, type FetchLike } from "./endpoint-request-coordinator";
import { NetworkRequestError, UnauthorizedError } from "./network-errors";
import { removeSuffix, resolveChatGPTBaseOrigin } from "./chatgpt-base-origin";

const requestTimeoutMilliseconds = 18_000;
const scope = "usage";

export interface UsageServiceOptions {
  fetchImpl?: FetchLike;
  dateProvider?: { unixSecondsNow(): number };
  endpointPreferenceStore?: EndpointPreferenceStore;
}

export class DefaultUsageService {
  private readonly dateProvider: { unixSecondsNow(): number };
  private readonly endpointCoordinator: EndpointRequestCoordinator;

  constructor(
    private readonly paths: Pick<FileSystemPaths, "codexConfigPath">,
    options: UsageServiceOptions = {}
  ) {
    this.dateProvider = options.dateProvider ?? { unixSecondsNow: () => Math.floor(Date.now() / 1000) };
    this.endpointCoordinator = new EndpointRequestCoordinator(
      options.fetchImpl ?? fetch,
      options.endpointPreferenceStore ?? new EndpointPreferenceStore()
    );
  }

  async fetchUsage(accessToken: string, accountId: string): Promise<UsageSnapshot> {
    try {
      const result = await this.endpointCoordinator.fetchFirstSuccessful(
        scope,
        await this.resolveUsageURLs(),
        () => ({
          method: "GET",
          signal: AbortSignal.timeout(requestTimeoutMilliseconds),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "ChatGPT-Account-Id": accountId,
            Accept: "application/json",
            "User-Agent": "codex-tools-windows/0.1"
          }
        })
      );
      return mapUsagePayload(result.data, this.dateProvider.unixSecondsNow());
    } catch (error) {
      if (error instanceof EndpointRequestError) {
        const message = endpointFailureMessage(error.failures);
        if (error.failures.some((failure) => failure.includes("-> 401:"))) {
          throw new UnauthorizedError(message);
        }
        throw new NetworkRequestError(message);
      }
      throw error;
    }
  }

  async resolveUsageURLs(): Promise<string[]> {
    const baseOrigin = await resolveChatGPTBaseOrigin(this.paths.codexConfigPath);
    const backendPrefix = "/backend-api";
    const whamPath = "/wham/usage";
    const codexPath = "/api/codex/usage";
    const originWithoutBackend = removeSuffix(baseOrigin, backendPrefix);
    const candidates = originWithoutBackend
      ? [
          `${baseOrigin}${whamPath}`,
          `${originWithoutBackend}${backendPrefix}${whamPath}`,
          `${originWithoutBackend}${codexPath}`
        ]
      : [`${baseOrigin}${backendPrefix}${whamPath}`, `${baseOrigin}${whamPath}`, `${baseOrigin}${codexPath}`];

    return dedupe([...candidates, "https://chatgpt.com/backend-api/wham/usage", "https://chatgpt.com/api/codex/usage"]);
  }
}

export function mapUsagePayload(payload: unknown, fetchedAt: number): UsageSnapshot {
  const object = asRecord(payload, "usage response");
  const windows: UsageWindowRaw[] = [];
  collectRateLimitWindows(object.rate_limit, windows);

  const additionalRateLimits = object.additional_rate_limits;
  if (Array.isArray(additionalRateLimits)) {
    for (const item of additionalRateLimits) {
      collectRateLimitWindows(asOptionalRecord(item)?.rate_limit, windows);
    }
  }

  const fiveHourRaw = pickNearestWindow(windows, 5 * 60 * 60);
  const oneWeekRaw = pickNearestWindow(windows, 7 * 24 * 60 * 60);

  return {
    fetchedAt,
    planType: optionalString(object.plan_type),
    fiveHour: fiveHourRaw ? toUsageWindow(fiveHourRaw) : undefined,
    oneWeek: oneWeekRaw ? toUsageWindow(oneWeekRaw) : undefined,
    credits: parseCredits(object.credits)
  };
}

function collectRateLimitWindows(value: unknown, windows: UsageWindowRaw[]): void {
  const rateLimit = asOptionalRecord(value);
  if (!rateLimit) {
    return;
  }

  const primaryWindow = parseUsageWindowRaw(rateLimit.primary_window);
  const secondaryWindow = parseUsageWindowRaw(rateLimit.secondary_window);
  if (primaryWindow) {
    windows.push(primaryWindow);
  }
  if (secondaryWindow) {
    windows.push(secondaryWindow);
  }
}

function parseUsageWindowRaw(value: unknown): UsageWindowRaw | undefined {
  const object = asOptionalRecord(value);
  if (!object) {
    return undefined;
  }

  return {
    usedPercent: readNumber(object.used_percent, "used_percent"),
    limitWindowSeconds: readInteger(object.limit_window_seconds, "limit_window_seconds"),
    resetAt: readInteger(object.reset_at, "reset_at")
  };
}

function toUsageWindow(raw: UsageWindowRaw): UsageWindow {
  return {
    usedPercent: raw.usedPercent,
    windowSeconds: raw.limitWindowSeconds,
    resetAt: raw.resetAt
  };
}

function parseCredits(value: unknown): CreditSnapshot | undefined {
  const object = asOptionalRecord(value);
  if (!object) {
    return undefined;
  }

  return {
    hasCredits: readBoolean(object.has_credits, "has_credits"),
    unlimited: readBoolean(object.unlimited, "unlimited"),
    balance: optionalString(object.balance)
  };
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

function asRecord(value: unknown, label: string): Record<string, unknown> {
  const object = asOptionalRecord(value);
  if (!object) {
    throw new Error(`${label} must be an object`);
  }
  return object;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function readInteger(value: unknown, label: string): number {
  const number = readNumber(value, label);
  if (!Number.isInteger(number)) {
    throw new Error(`${label} must be an integer`);
  }
  return number;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
