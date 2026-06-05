import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexAppProxyApiKeyEnvironmentVariable } from "../src/shared/models/codex-app-integration";
import type { FileSystemPaths } from "../src/main/repositories/file-system-paths";
import { CodexAppIntegrationService } from "../src/main/services/codex-app-integration-service";

const tempRoots: string[] = [];

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
    expect(config).toContain('model = "gpt-5.5"');
    expect(config).toContain('model_provider = "codexmanager"');
    expect(config).toContain("[model_providers.codexmanager]");
    expect(config).toContain('base_url = "http://127.0.0.1:18317/v1"');
    expect(guiEnvironment.values).toEqual([{ name: codexAppProxyApiKeyEnvironmentVariable, value: "sk-local-test" }]);
    expect(JSON.stringify(manifest)).not.toContain("sk-local-test");
  });

  it("safe-restores managed keys while preserving unrelated user edits", async () => {
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

    const status = await service.restoreSafe();
    const restored = await readFile(paths.codexConfigPath, "utf8");

    expect(status.state).toBe("not_configured");
    expect(restored).toContain('model = "gpt-original"');
    expect(restored).toContain('model_provider = "openai"');
    expect(restored).toContain("[model_providers.openai_proxy]");
    expect(restored).toContain("[mcp_servers.example]");
    expect(restored).not.toContain("[model_providers.codexmanager]");
  });

  it("full snapshot restore removes config files that did not exist before configure", async () => {
    const paths = await makeTempPaths();
    const service = new CodexAppIntegrationService(paths, proxyRuntime(), new RecordingGUIEnvironment());

    await service.configure();
    await service.restoreSnapshot();

    await expect(readFile(paths.codexConfigPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
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

    await expect(service.status()).resolves.toMatchObject({ state: "drifted", hasBackup: true });
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
      warning: "launchctl failed"
    });
  });
});

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
