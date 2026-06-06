import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexAppProxyApiKeyEnvironmentVariable } from "../src/shared/models/codex-app-integration";
import type { FileSystemPaths } from "../src/main/repositories/file-system-paths";
import { CodexAppIntegrationService } from "../src/main/services/codex-app-integration-service";

const tempRoots: string[] = [];
const sqlite3Available = spawnSync("sqlite3", ["--version"], { encoding: "utf8" }).status === 0;
const sqliteIt = sqlite3Available ? it : it.skip;

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex app integration service", () => {
  it("configures an empty Codex config with a managed provider and GUI environment key", async () => {
    const paths = await makeTempPaths();
    const guiEnvironment = new RecordingGUIEnvironment();
    const service = new CodexAppIntegrationService(paths, proxyRuntime(), guiEnvironment, { unixSecondsNow: () => 1_780_200_001 });

    const status = await service.configure();
    const config = await readFile(paths.codexConfigPath, "utf8");
    const manifest = JSON.parse(await readFile(join(paths.applicationSupportDirectory, "codex-app-integration.json"), "utf8")) as Record<string, unknown>;

    expect(status.state).toBe("configured");
    expect(status.canRestore).toBe(true);
    expect(config).toContain('model = "gpt-5.5"');
    expect(config).toContain('model_provider = "codexmanager"');
    expect(config).toContain("[model_providers.codexmanager]");
    expect(config).toContain('base_url = "http://127.0.0.1:18317/v1"');
    expect(config).toContain("request_max_retries = 4");
    expect(config).toContain("stream_max_retries = 5");
    expect(guiEnvironment.values).toEqual([{ name: codexAppProxyApiKeyEnvironmentVariable, value: "sk-local-test" }]);
    expect(JSON.stringify(manifest)).not.toContain("sk-local-test");
    expect(manifest).not.toHaveProperty("backupPath");
  });

  it("enables proxy mode without rewriting Codex history providers", async () => {
    const paths = await makeTempPaths();
    const historyPath = join(dirname(paths.codexConfigPath), "sessions", "2026", "06", "05", "rollout-test.jsonl");
    const otherProviderHistoryPath = join(dirname(paths.codexConfigPath), "sessions", "2026", "06", "05", "rollout-ollama.jsonl");
    await writeFile(
      paths.codexConfigPath,
      [
        'model = "gpt-5.5"',
        'model_provider = "openai"',
        "",
        "[projects.example]",
        'trust_level = "trusted"',
        ""
      ].join("\n"),
      "utf8"
    );
    await writeRollout(historyPath, "openai");
    await writeRollout(otherProviderHistoryPath, "ollama");
    const service = new CodexAppIntegrationService(paths, proxyRuntime(), new RecordingGUIEnvironment());

    const status = await service.configure();
    const config = await readFile(paths.codexConfigPath, "utf8");
    const manifest = JSON.parse(await readFile(join(paths.applicationSupportDirectory, "codex-app-integration.json"), "utf8")) as Record<string, unknown>;

    expect(status).toMatchObject({ state: "configured", model: "gpt-5.5", providerId: "codexmanager" });
    expect(config).toContain('model = "gpt-5.5"');
    expect(config).toContain('model_provider = "codexmanager"');
    expect(config).toContain("[projects.example]");
    expect(config).toContain("[model_providers.codexmanager]");
    await expect(readRolloutProvider(historyPath)).resolves.toBe("openai");
    await expect(readRolloutProvider(otherProviderHistoryPath)).resolves.toBe("ollama");
    expect(manifest).not.toHaveProperty("historyPatches");
    expect(manifest).not.toHaveProperty("historySyncedAt");

    await service.restore();

    await expect(readRolloutProvider(historyPath)).resolves.toBe("openai");
    await expect(readRolloutProvider(otherProviderHistoryPath)).resolves.toBe("ollama");
  });

  sqliteIt("leaves Codex rollout database providers unchanged", async () => {
    const paths = await makeTempPaths();
    const historyPath = join(dirname(paths.codexConfigPath), "sessions", "2026", "06", "05", "rollout-test.jsonl");
    const otherProviderHistoryPath = join(dirname(paths.codexConfigPath), "sessions", "2026", "06", "05", "rollout-ollama.jsonl");
    const stateDatabasePath = join(dirname(paths.codexConfigPath), "state_5.sqlite");
    await writeFile(paths.codexConfigPath, "", "utf8");
    await writeRollout(historyPath, "openai");
    await writeRollout(otherProviderHistoryPath, "ollama");
    await createStateDatabase(stateDatabasePath, [
      { id: "thread-openai", path: historyPath, provider: "openai" },
      { id: "thread-ollama", path: otherProviderHistoryPath, provider: "ollama" }
    ]);
    const service = new CodexAppIntegrationService(paths, proxyRuntime(), new RecordingGUIEnvironment());

    await service.configure();
    const manifest = JSON.parse(await readFile(join(paths.applicationSupportDirectory, "codex-app-integration.json"), "utf8")) as Record<string, unknown>;

    await expect(readThreadProvider(stateDatabasePath, historyPath)).resolves.toBe("openai");
    await expect(readThreadProvider(stateDatabasePath, otherProviderHistoryPath)).resolves.toBe("ollama");
    expect(manifest).not.toHaveProperty("historyPatches");

    await service.restore();

    await expect(readRolloutProvider(historyPath)).resolves.toBe("openai");
    await expect(readThreadProvider(stateDatabasePath, historyPath)).resolves.toBe("openai");
    await expect(readThreadProvider(stateDatabasePath, otherProviderHistoryPath)).resolves.toBe("ollama");
  });

  sqliteIt("restores legacy history patches left by older proxy configuration", async () => {
    const paths = await makeTempPaths();
    const historyPath = join(dirname(paths.codexConfigPath), "sessions", "2026", "06", "05", "rollout-legacy.jsonl");
    const stateDatabasePath = join(dirname(paths.codexConfigPath), "state_5.sqlite");
    await writeFile(
      paths.codexConfigPath,
      [
        'model = "gpt-5.5"',
        'model_provider = "codexmanager"',
        "",
        "[model_providers.codexmanager]",
        'name = "CodexManager Proxy"',
        'base_url = "http://127.0.0.1:18317/v1"',
        'wire_api = "responses"',
        `env_key = "${codexAppProxyApiKeyEnvironmentVariable}"`,
        "requires_openai_auth = false",
        "request_max_retries = 4",
        "stream_max_retries = 5",
        "stream_idle_timeout_ms = 300000",
        ""
      ].join("\n"),
      "utf8"
    );
    await writeRollout(historyPath, "codexmanager");
    await createStateDatabase(stateDatabasePath, [
      { id: "thread-legacy", path: historyPath, provider: "codexmanager" }
    ]);
    await writeFile(
      join(paths.applicationSupportDirectory, "codex-app-integration.json"),
      JSON.stringify({
        backupPath: join(paths.applicationSupportDirectory, "legacy-backup.toml"),
        configuredAt: 1,
        configuredConfigHash: "legacy-config-hash",
        envVarName: codexAppProxyApiKeyEnvironmentVariable,
        historyPatches: [
          {
            appliedProvider: "codexmanager",
            path: historyPath,
            previousDatabaseProvider: "openai",
            previousProvider: "openai"
          }
        ],
        originalConfigExisted: true,
        originalConfigHash: "legacy-original-hash",
        previousRootModelLine: 'model = "gpt-5.5"',
        previousRootModelProviderLine: 'model_provider = "openai"',
        proxyURL: "http://127.0.0.1:18317",
        version: 1
      }),
      "utf8"
    );
    const service = new CodexAppIntegrationService(paths, proxyRuntime(), new RecordingGUIEnvironment());

    await service.restore();

    await expect(readRolloutProvider(historyPath)).resolves.toBe("openai");
    await expect(readThreadProvider(stateDatabasePath, historyPath)).resolves.toBe("openai");
    await expect(readFile(join(paths.applicationSupportDirectory, "codex-app-integration.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores managed keys while preserving unrelated user edits", async () => {
    const paths = await makeTempPaths();
    await writeFile(
      paths.codexConfigPath,
      [
        "# user config",
        'model = "gpt-original"',
        'model_provider = "openai"',
        "",
        "[model_providers.openai_proxy]",
        'name = "Existing proxy"',
        'base_url = "https://proxy.example.test/v1"',
        ""
      ].join("\n"),
      "utf8"
    );
    const service = new CodexAppIntegrationService(paths, proxyRuntime(), new RecordingGUIEnvironment());

    await service.configure();
    await writeFile(
      paths.codexConfigPath,
      `${await readFile(paths.codexConfigPath, "utf8")}\n[mcp_servers.example]\ncommand = "example"\n`,
      "utf8"
    );

    const status = await service.restore();
    const restored = await readFile(paths.codexConfigPath, "utf8");

    expect(status.state).toBe("not_configured");
    expect(restored).toContain('model = "gpt-original"');
    expect(restored).toContain('model_provider = "openai"');
    expect(restored).toContain("[model_providers.openai_proxy]");
    expect(restored).toContain("[mcp_servers.example]");
    expect(restored).not.toContain("[model_providers.codexmanager]");
  });

  it("restores without metadata by removing only managed config", async () => {
    const paths = await makeTempPaths();
    await writeFile(
      paths.codexConfigPath,
      [
        'model = "gpt-5.5"',
        'model_provider = "codexmanager"',
        "",
        "[projects.example]",
        'trust_level = "trusted"',
        "",
        "[model_providers.codexmanager]",
        'name = "CodexManager Proxy"',
        'base_url = "http://127.0.0.1:18317/v1"',
        'wire_api = "responses"',
        `env_key = "${codexAppProxyApiKeyEnvironmentVariable}"`,
        "requires_openai_auth = false",
        "request_max_retries = 4",
        "stream_max_retries = 5",
        "stream_idle_timeout_ms = 300000",
        ""
      ].join("\n"),
      "utf8"
    );
    const service = new CodexAppIntegrationService(paths, proxyRuntime(), new RecordingGUIEnvironment());

    await expect(service.status()).resolves.toMatchObject({ canRestore: true, state: "configured" });
    await service.restore();
    const restored = await readFile(paths.codexConfigPath, "utf8");

    expect(restored).toContain("[projects.example]");
    expect(restored).not.toContain('model_provider = "codexmanager"');
    expect(restored).not.toContain("[model_providers.codexmanager]");
  });

  it("reports drift when managed provider metadata exists but config no longer matches", async () => {
    const paths = await makeTempPaths();
    const service = new CodexAppIntegrationService(paths, proxyRuntime(), new RecordingGUIEnvironment());

    await service.configure();
    await writeFile(
      paths.codexConfigPath,
      (await readFile(paths.codexConfigPath, "utf8")).replace("http://127.0.0.1:18317/v1", "http://127.0.0.1:19999/v1"),
      "utf8"
    );

    await expect(service.status()).resolves.toMatchObject({ state: "drifted", canRestore: true });
  });

  it("returns a warning when the GUI environment update fails", async () => {
    const paths = await makeTempPaths();
    const service = new CodexAppIntegrationService(paths, proxyRuntime(), {
      async setEnvironmentVariable(): Promise<{ warning?: string }> {
        throw new Error("launchctl failed");
      }
    });

    await expect(service.configure()).resolves.toMatchObject({
      state: "configured",
      warning: expect.stringContaining("launchctl failed") as string
    });
  });
});

async function writeRollout(path: string, provider: string | undefined): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload: Record<string, unknown> = {
    id: "019e94fd-0000-7000-8000-000000000001",
    timestamp: "2026-06-05T00:00:00.000Z",
    cwd: "/tmp/project",
    originator: "Codex Desktop",
    cli_version: "0.0.0",
    source: "app"
  };
  if (provider !== undefined) {
    payload.model_provider = provider;
  }
  await writeFile(
    path,
    `${JSON.stringify({ timestamp: "2026-06-05T00:00:01.000Z", type: "session_meta", payload })}\n{"type":"noop"}\n`,
    "utf8"
  );
}

async function readRolloutProvider(path: string): Promise<unknown> {
  const [firstLine] = (await readFile(path, "utf8")).split("\n");
  const parsed = JSON.parse(firstLine ?? "") as { payload?: { model_provider?: unknown } };
  return parsed.payload?.model_provider;
}

async function createStateDatabase(
  path: string,
  rows: Array<{ id: string; path: string; provider: string }>
): Promise<void> {
  await runSQLite(
    path,
    [
      "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, model_provider TEXT NOT NULL);",
      ...rows.map(
        (row) =>
          `INSERT INTO threads (id, rollout_path, model_provider) VALUES (${sqliteString(row.id)}, ${sqliteString(row.path)}, ${sqliteString(row.provider)});`
      )
    ].join("\n")
  );
}

async function readThreadProvider(databasePath: string, rolloutPath: string): Promise<string> {
  return (await runSQLite(databasePath, `SELECT model_provider FROM threads WHERE rollout_path = ${sqliteString(rolloutPath)};`)).trim();
}

async function runSQLite(databasePath: string, script: string): Promise<string> {
  const result = spawnSync("sqlite3", [databasePath], {
    encoding: "utf8",
    input: script,
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `sqlite3 exited with ${result.status ?? "unknown"}`);
  }
  return result.stdout;
}

function sqliteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

class RecordingGUIEnvironment {
  readonly values: Array<{ name: string; value: string }> = [];

  async setEnvironmentVariable(name: string, value: string): Promise<{ warning?: string }> {
    this.values.push({ name, value });
    return {};
  }
}

function proxyRuntime(port = 18_317): { getState(): Promise<{ apiKey: string; port: number }> } {
  return {
    async getState(): Promise<{ apiKey: string; port: number }> {
      return { apiKey: "sk-local-test", port };
    }
  };
}

async function makeTempPaths(): Promise<FileSystemPaths> {
  const root = await mkdtemp(join(tmpdir(), "codexmanager-codex-app-"));
  tempRoots.push(root);
  const applicationSupportDirectory = join(root, "Application Support", "CodexManager");
  const codexDirectory = join(root, ".codex");
  await mkdir(applicationSupportDirectory, { recursive: true });
  await mkdir(codexDirectory, { recursive: true });
  return {
    accountStorePath: join(applicationSupportDirectory, "accounts.json"),
    applicationSupportDirectory,
    codexAuthPath: join(codexDirectory, "auth.json"),
    codexConfigPath: join(codexDirectory, "config.toml"),
    settingsStorePath: join(applicationSupportDirectory, "settings.json")
  };
}
