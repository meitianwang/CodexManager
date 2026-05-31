import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWindowsAppContext } from "../src/main/app-context";
import { defaultAppSettings } from "../src/shared/models/settings";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Windows app context", () => {
  it("auto-starts the proxy when the persisted setting is enabled", async () => {
    const previousSmokeRoot = process.env.CODEX_MANAGER_ELECTRON_SMOKE_ROOT;
    const root = await makeTempRoot();
    process.env.CODEX_MANAGER_ELECTRON_SMOKE_ROOT = root;

    const settingsDirectory = join(root, "app-data", "CodexManager");
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      join(settingsDirectory, "settings.json"),
      JSON.stringify({
        ...defaultAppSettings(),
        autoStartProxy: true,
        proxyApiKey: "sk-local-auto-start",
        proxyPort: 0
      }),
      "utf8"
    );

    let context: Awaited<ReturnType<typeof createWindowsAppContext>> | undefined;
    try {
      context = await createWindowsAppContext(new FakeElectronApp() as unknown as Parameters<typeof createWindowsAppContext>[0]);
      const state = await context.proxyRuntimeService.getState();
      expect(state.isRunning).toBe(true);
      expect(state.apiKey).toBe("sk-local-auto-start");
      expect(state.port).toBeGreaterThan(0);

      const response = await fetch(`${state.proxyURL}/health`);
      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toEqual({ status: "ok" });
    } finally {
      await context?.proxyRuntimeService.stop();
      restoreOptionalEnvironmentValue("CODEX_MANAGER_ELECTRON_SMOKE_ROOT", previousSmokeRoot);
    }
  });
});

class FakeElectronApp {
  getLoginItemSettings(): { openAtLogin: boolean } {
    return { openAtLogin: false };
  }

  getPath(name: string): string {
    return join(tmpdir(), "codexmanager-fake-electron", name);
  }

  setLoginItemSettings(): void {}
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codexmanager-windows-context-"));
  tempRoots.push(root);
  return root;
}

function restoreOptionalEnvironmentValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
