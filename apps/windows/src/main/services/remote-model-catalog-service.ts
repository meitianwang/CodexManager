import type { AccountsStore } from "../../shared/models/accounts";
import { effectivePlanType } from "../../shared/domain/account-plan-resolver";
import type { AccountsStoreRepositoryLike } from "./accounts-coordinator";
import { boundedResponseText } from "./bounded-response";

const defaultRemoteModelURLs = [
  "https://models.router-for.me/models.json",
  "https://raw.githubusercontent.com/router-for-me/models/refs/heads/main/models.json"
] as const;

const maxCatalogBytes = 2 * 1024 * 1024;

export interface RemoteModelCatalogServiceOptions {
  fetchImpl?: typeof fetch;
  modelURLs?: readonly string[];
  storeRepository: AccountsStoreRepositoryLike;
  timeoutMs?: number;
}

export class RemoteModelCatalogService {
  private readonly fetchImpl: typeof fetch;
  private readonly modelURLs: readonly string[];
  private readonly storeRepository: AccountsStoreRepositoryLike;
  private readonly timeoutMs: number;
  private cachedModels: string[] | undefined;
  private cachedModelsByPlanKey: Map<string, Set<string>> | undefined;

  constructor(options: RemoteModelCatalogServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.modelURLs = options.modelURLs ?? defaultRemoteModelURLs;
    this.storeRepository = options.storeRepository;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  cachedAvailableModels(): string[] | undefined {
    return this.cachedModels ? [...this.cachedModels] : undefined;
  }

  cachedModelIDsByPlanKey(): ReadonlyMap<string, ReadonlySet<string>> | undefined {
    return this.cachedModelsByPlanKey;
  }

  async refreshModels(): Promise<string[] | undefined> {
    const planKeys = this.resolvePlanKeys(await this.storeRepository.loadStore());
    if (planKeys.length === 0) {
      this.cachedModels = undefined;
      this.cachedModelsByPlanKey = undefined;
      return undefined;
    }

    for (const url of this.modelURLs) {
      try {
        const catalog = await this.fetchModels(url, planKeys);
        if (catalog.ids.length > 0) {
          this.cachedModels = catalog.ids;
          this.cachedModelsByPlanKey = catalog.idsByPlanKey;
          return [...catalog.ids];
        }
      } catch (error) {
        console.warn(`Failed to fetch remote model catalog from ${url}`, error);
      }
    }

    return undefined;
  }

  private resolvePlanKeys(store: AccountsStore): string[] {
    const planKeys: string[] = [];
    const seen = new Set<string>();
    for (const account of store.accounts) {
      const planKey = modelCatalogPlanKey(effectivePlanType(account.planType, account.usage?.planType));
      if (!seen.has(planKey)) {
        seen.add(planKey);
        planKeys.push(planKey);
      }
    }
    return planKeys;
  }

  private async fetchModels(url: string, planKeys: readonly string[]): Promise<FetchedModelCatalog> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        return emptyFetchedModelCatalog();
      }
      return collectModelCatalog(JSON.parse(await boundedResponseText(response, maxCatalogBytes)), planKeys);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function collectModelIDs(catalog: unknown, planKeys: readonly string[]): string[] {
  return collectModelCatalog(catalog, planKeys).ids;
}

interface FetchedModelCatalog {
  ids: string[];
  idsByPlanKey: Map<string, Set<string>>;
}

function collectModelCatalog(catalog: unknown, planKeys: readonly string[]): FetchedModelCatalog {
  if (!isRecord(catalog)) {
    return emptyFetchedModelCatalog();
  }

  const seen = new Set<string>();
  const result: string[] = [];
  const idsByPlanKey = new Map<string, Set<string>>();
  for (const key of planKeys) {
    const entries = catalog[key];
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      const id = modelIDFromCatalogEntry(entry);
      if (id && !seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
      if (id) {
        const planModels = idsByPlanKey.get(key) ?? new Set<string>();
        planModels.add(id);
        idsByPlanKey.set(key, planModels);
      }
    }
  }
  return { ids: result, idsByPlanKey };
}

export function modelCatalogPlanKey(planType: string): string {
  switch (planType) {
    case "free":
      return "codex-free";
    case "plus":
      return "codex-plus";
    case "pro":
    case "prolite":
    case "pro_lite":
      return "codex-pro";
    default:
      return "codex-team";
  }
}

function modelIDFromCatalogEntry(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = value.id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyFetchedModelCatalog(): FetchedModelCatalog {
  return {
    ids: [],
    idsByPlanKey: new Map()
  };
}
