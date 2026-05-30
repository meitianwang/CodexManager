import type { WorkspaceMetadata } from "../../shared/models/auth";
import type { FileSystemPaths } from "../repositories/file-system-paths";
import { EndpointPreferenceStore, EndpointRequestCoordinator, EndpointRequestError, type FetchLike } from "./endpoint-request-coordinator";
import { removeSuffix, resolveChatGPTBaseOrigin } from "./chatgpt-base-origin";
import { NetworkRequestError } from "./network-errors";

const requestTimeoutMilliseconds = 5_000;
const scope = "workspace-metadata";

export interface WorkspaceMetadataServiceOptions {
  fetchImpl?: FetchLike;
  endpointPreferenceStore?: EndpointPreferenceStore;
}

export class DefaultWorkspaceMetadataService {
  private readonly endpointCoordinator: EndpointRequestCoordinator;

  constructor(
    private readonly paths: Pick<FileSystemPaths, "codexConfigPath">,
    options: WorkspaceMetadataServiceOptions = {}
  ) {
    this.endpointCoordinator = new EndpointRequestCoordinator(
      options.fetchImpl ?? fetch,
      options.endpointPreferenceStore ?? new EndpointPreferenceStore()
    );
  }

  async fetchWorkspaceMetadata(accessToken: string): Promise<WorkspaceMetadata[]> {
    try {
      const result = await this.endpointCoordinator.fetchFirstSuccessful(
        scope,
        await this.resolveAccountURLs(),
        () => ({
          method: "GET",
          signal: AbortSignal.timeout(requestTimeoutMilliseconds),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "User-Agent": "codex-tools-windows/0.1"
          }
        })
      );
      return mapWorkspaceMetadataPayload(result.data);
    } catch (error) {
      if (error instanceof EndpointRequestError) {
        throw new NetworkRequestError(endpointFailureMessage(error.failures));
      }
      throw error;
    }
  }

  async resolveAccountURLs(): Promise<string[]> {
    const baseOrigin = await resolveChatGPTBaseOrigin(this.paths.codexConfigPath);
    const backendPrefix = "/backend-api";
    const originWithoutBackend = removeSuffix(baseOrigin, backendPrefix);
    const candidates = originWithoutBackend
      ? [`${baseOrigin}/accounts`, `${originWithoutBackend}${backendPrefix}/accounts`]
      : [`${baseOrigin}${backendPrefix}/accounts`, `${baseOrigin}/accounts`];
    return dedupe([...candidates, "https://chatgpt.com/backend-api/accounts"]);
  }
}

export function mapWorkspaceMetadataPayload(payload: unknown): WorkspaceMetadata[] {
  const object = asRecord(payload, "workspace accounts response");
  if (!Array.isArray(object.items)) {
    throw new Error("workspace accounts response items must be an array");
  }

  return object.items.map((item) => {
    const account = asRecord(item, "workspace account");
    return {
      accountId: readString(account.id, "id"),
      workspaceName: optionalString(account.name),
      structure: optionalString(account.structure)
    };
  });
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
