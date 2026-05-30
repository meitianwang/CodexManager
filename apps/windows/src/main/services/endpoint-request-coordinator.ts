import { boundedResponseText } from "./bounded-response";

export interface EndpointFetchResult {
  endpoint: string;
  data: unknown;
}

export type FetchLike = typeof fetch;

export class EndpointRequestError extends Error {
  constructor(public readonly failures: string[]) {
    super(`All endpoint requests failed: ${failures.join(" | ")}`);
    this.name = "EndpointRequestError";
  }
}

export class EndpointPreferenceStore {
  private readonly preferredByScope = new Map<string, string>();

  prioritizedCandidates(scope: string, candidates: readonly string[]): string[] {
    const deduped = dedupe(candidates);
    const preferred = this.preferredByScope.get(scope);
    if (!preferred || !deduped.includes(preferred)) {
      return deduped;
    }
    return [preferred, ...deduped.filter((candidate) => candidate !== preferred)];
  }

  recordSuccess(scope: string, endpoint: string): void {
    this.preferredByScope.set(scope, endpoint);
  }
}

export class EndpointRequestCoordinator {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly preferenceStore: EndpointPreferenceStore = new EndpointPreferenceStore()
  ) {}

  async fetchFirstSuccessful(
    scope: string,
    candidateUrls: readonly string[],
    makeRequest: (endpoint: string) => RequestInit
  ): Promise<EndpointFetchResult> {
    const failures: string[] = [];
    for (const endpoint of this.preferenceStore.prioritizedCandidates(scope, candidateUrls)) {
      try {
        const response = await this.fetchImpl(endpoint, makeRequest(endpoint));
        if (!response.ok) {
          const body = await boundedResponseText(response);
          const detail = body ? ` ${body}` : "";
          failures.push(`${endpoint} -> ${response.status}:${detail}`);
          continue;
        }

        const data = await response.json();
        this.preferenceStore.recordSuccess(scope, endpoint);
        return { endpoint, data };
      } catch (error) {
        failures.push(`${endpoint} -> ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new EndpointRequestError(failures);
  }
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
