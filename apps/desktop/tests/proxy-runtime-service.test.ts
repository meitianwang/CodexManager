import { describe, expect, it, vi } from "vitest";
import type { AccountsStore } from "../src/shared/models/accounts";
import type { AppSettings, AppSettingsPatch } from "../src/shared/models/settings";
import { defaultAppSettings, resolveAppLocale } from "../src/shared/models/settings";
import { proxyAvailableModels } from "../src/shared/models/proxy";
import type { JSONValue } from "../src/shared/models/json-value";
import type { ProxyCoordinator } from "../src/main/proxy/proxy-coordinator";
import type { SettingsCoordinator } from "../src/main/services/settings-coordinator";
import { ProxyRuntimeService } from "../src/main/services/proxy-runtime-service";
import {
  collectModelIDs,
  modelCatalogPlanKey,
  RemoteModelCatalogService
} from "../src/main/services/remote-model-catalog-service";

describe("remote model catalog service", () => {
  it("maps account plans to remote catalog keys", () => {
    expect(modelCatalogPlanKey("free")).toBe("codex-free");
    expect(modelCatalogPlanKey("plus")).toBe("codex-plus");
    expect(modelCatalogPlanKey("pro_lite")).toBe("codex-pro");
    expect(modelCatalogPlanKey("enterprise")).toBe("codex-team");
  });

  it("collects model ids for selected plans without duplicates", () => {
    expect(
      collectModelIDs(
        {
          "codex-plus": [{ id: "gpt-plus" }, { id: "shared" }],
          "codex-pro": [{ id: "shared" }, { id: "gpt-pro" }]
        },
        ["codex-plus", "codex-pro"]
      )
    ).toEqual(["gpt-plus", "shared", "gpt-pro"]);
  });
});

describe("proxy runtime service models", () => {
  it("refreshes available models from the remote catalog when the proxy starts", async () => {
    const settingsCoordinator = new FakeSettingsCoordinator({ ...defaultAppSettings(), proxyApiKey: "sk-local-test" });
    const proxyCoordinator = new FakeProxyCoordinator(18444);
    const modelCatalogService = new RemoteModelCatalogService({
      fetchImpl: vi.fn(async () =>
        new Response(
          JSON.stringify({
            "codex-plus": [{ id: "plus-model" }, { id: "shared-model" }],
            "codex-pro": [{ id: "shared-model" }, { id: "pro-model" }]
          }),
          { status: 200 }
        )
      ),
      modelURLs: ["https://example.test/models.json"],
      storeRepository: new MemoryStoreRepository({
        version: 1,
        accounts: [
          makeStoredAccount("plus-account", "plus"),
          makeStoredAccount("pro-account", "pro")
        ]
      })
    });
    const service = new ProxyRuntimeService(
      proxyCoordinator as unknown as ProxyCoordinator,
      settingsCoordinator as unknown as SettingsCoordinator,
      { modelCatalogService }
    );

    const state = await service.start(18444, "sk-local-test");

    expect(proxyCoordinator.startedPort).toBe(18444);
    expect(state.availableModels).toEqual(["plus-model", "shared-model", "pro-model"]);
  });

  it("falls back to built-in models when remote catalog refresh fails", async () => {
    const settingsCoordinator = new FakeSettingsCoordinator({ ...defaultAppSettings(), proxyApiKey: "sk-local-test" });
    const modelCatalogService = new RemoteModelCatalogService({
      fetchImpl: vi.fn(async () => new Response("missing", { status: 404 })),
      modelURLs: ["https://example.test/models.json"],
      storeRepository: new MemoryStoreRepository({
        version: 1,
        accounts: [makeStoredAccount("team-account", "team")]
      })
    });
    const service = new ProxyRuntimeService(
      new FakeProxyCoordinator(0) as unknown as ProxyCoordinator,
      settingsCoordinator as unknown as SettingsCoordinator,
      { modelCatalogService }
    );

    const state = await service.start(0, "sk-local-test");

    expect(state.availableModels).toEqual([...proxyAvailableModels]);
  });
});

class FakeProxyCoordinator {
  public startedPort: number | undefined;

  constructor(private readonly resolvedPort: number) {}

  async start(port: number): Promise<number> {
    this.startedPort = port;
    return this.resolvedPort;
  }

  async stop(): Promise<void> {
    this.startedPort = undefined;
  }
}

class FakeSettingsCoordinator {
  constructor(private settings: AppSettings) {}

  async currentSettings(): Promise<AppSettings> {
    return { ...this.settings };
  }

  async updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      ...patch,
      locale: patch.locale !== undefined ? resolveAppLocale(patch.locale) : this.settings.locale
    };
    return { ...this.settings };
  }
}

class MemoryStoreRepository {
  constructor(private readonly store: AccountsStore) {}

  async loadStore(): Promise<AccountsStore> {
    return structuredClone(this.store);
  }

  async saveStore(): Promise<void> {
    throw new Error("saveStore is not used by model catalog tests");
  }
}

function makeStoredAccount(id: string, planType: string) {
  const authJson: JSONValue = {
    accountId: `acct-${id}`,
    accessToken: `access-${id}`
  };
  return {
    id,
    label: id,
    accountId: `acct-${id}`,
    planType,
    authJson,
    addedAt: 1,
    updatedAt: 1
  };
}
