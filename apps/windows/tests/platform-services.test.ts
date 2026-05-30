import { describe, expect, it } from "vitest";
import {
  CommandTimeoutError,
  environmentWithPrependedPath,
  resolveExecutable,
  runCommand,
  type CommandResult,
  type DetachedLaunchOptions
} from "../src/main/platform/command-runner";
import { CodexCLIService } from "../src/main/platform/codex-cli-service";
import { EditorAppService } from "../src/main/platform/editor-app-service";
import { LaunchAtStartupService, type LoginItemSettings } from "../src/main/platform/launch-at-startup-service";
import { TrayService, type TrayActionID, type TrayMenuItem } from "../src/main/platform/tray-service";

describe("command runner", () => {
  it("throws promptly when a command times out", async () => {
    const start = Date.now();
    await expect(
      runCommand(process.execPath, ["-e", "setTimeout(() => undefined, 5000)"], { timeoutMs: 100 })
    ).rejects.toBeInstanceOf(CommandTimeoutError);
    expect(Date.now() - start).toBeLessThan(3_000);
  });

  it("keeps bounded stdout and stderr tails", async () => {
    const script = [
      "process.stdout.write('x'.repeat(20000) + 'stdout-tail')",
      "process.stderr.write('e'.repeat(20000) + 'stderr-tail')"
    ].join(";");
    const result = await runCommand(process.execPath, ["-e", script], { maxOutputBytes: 64 });

    expect(result.stdout.length).toBeLessThanOrEqual(64);
    expect(result.stderr.length).toBeLessThanOrEqual(64);
    expect(result.stdout.endsWith("stdout-tail")).toBe(true);
    expect(result.stderr.endsWith("stderr-tail")).toBe(true);
  });

  it("resolves Windows executables from PATH and PATHEXT", () => {
    const found = resolveExecutable("codex", {
      environment: {
        PATH: String.raw`C:\Tools;D:\Bin`,
        PATHEXT: ".CMD;.EXE"
      },
      executableExists: (path) => path === String.raw`D:\Bin\codex.CMD`,
      pathDelimiter: ";"
    });

    expect(found).toBe(String.raw`D:\Bin\codex.CMD`);
  });

  it("prepends executable directories without changing the PATH key casing", () => {
    const environment = environmentWithPrependedPath(String.raw`C:\Codex`, { Path: String.raw`C:\Base` }, ";");

    expect(environment.Path).toBe(String.raw`C:\Codex;C:\Base`);
  });
});

describe("Codex CLI service", () => {
  it("launches the desktop app when a Windows Codex executable is installed", async () => {
    const codexApp = String.raw`C:\Users\me\AppData\Local\Programs\Codex\Codex.exe`;
    const launched: DetachedLaunchCall[] = [];
    const service = new CodexCLIService({
      environment: {
        LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local`,
        PATH: ""
      },
      executableExists: existingPathSet([codexApp]),
      launchDetached: recordingLauncher(launched),
      runCommand: successfulRunner(),
      sleep: async () => undefined
    });

    await expect(service.launchApp(String.raw`C:\workspaces\demo`)).resolves.toBe(false);
    expect(launched).toEqual([
      {
        launchPath: codexApp,
        argumentsList: [String.raw`C:\workspaces\demo`],
        environmentPath: undefined
      }
    ]);
  });

  it("falls back to codex app through the CLI when the desktop app is unavailable", async () => {
    const codexCLI = String.raw`C:\Users\me\AppData\Roaming\npm\codex.cmd`;
    const launched: DetachedLaunchCall[] = [];
    const service = new CodexCLIService({
      environment: {
        APPDATA: String.raw`C:\Users\me\AppData\Roaming`,
        Path: String.raw`C:\Windows\System32`
      },
      executableExists: existingPathSet([codexCLI]),
      launchDetached: recordingLauncher(launched),
      runCommand: successfulRunner(),
      sleep: async () => undefined
    });

    await expect(service.launchApp(String.raw`C:\workspaces\demo`)).resolves.toBe(true);
    expect(launched).toEqual([
      {
        launchPath: codexCLI,
        argumentsList: ["app", String.raw`C:\workspaces\demo`],
        environmentPath: String.raw`C:\Users\me\AppData\Roaming\npm;C:\Windows\System32`
      }
    ]);
  });
});

describe("editor app service", () => {
  it("lists installed Windows editors from common installation directories", () => {
    const service = new EditorAppService({
      environment: {
        LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local`,
        ProgramFiles: String.raw`C:\Program Files`,
        PATH: ""
      },
      executableExists: existingPathSet([
        String.raw`C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe`,
        String.raw`C:\Program Files\Cursor\Cursor.exe`
      ])
    });

    expect(service.listInstalledApps()).toEqual([
      { id: "vscode", label: "VS Code" },
      { id: "cursor", label: "Cursor" }
    ]);
  });

  it("restarts selected editors with taskkill and detached relaunch", async () => {
    const cursorPath = String.raw`C:\Users\me\AppData\Local\Programs\Cursor\Cursor.exe`;
    const commands: CommandCall[] = [];
    const launched: DetachedLaunchCall[] = [];
    const service = new EditorAppService({
      environment: {
        LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local`,
        PATH: ""
      },
      executableExists: existingPathSet([cursorPath]),
      launchDetached: recordingLauncher(launched),
      runCommand: recordingRunner(commands),
      sleep: async () => undefined
    });

    await expect(service.restartSelectedApps(["cursor"])).resolves.toEqual({
      restarted: ["cursor"],
      error: undefined
    });
    expect(commands).toEqual([{ launchPath: "taskkill", argumentsList: ["/IM", "Cursor.exe", "/F", "/T"] }]);
    expect(launched).toEqual([
      {
        launchPath: cursorPath,
        argumentsList: [],
        environmentPath: undefined
      }
    ]);
  });

  it("reports an error when no restart targets are selected", async () => {
    const service = new EditorAppService();

    await expect(service.restartSelectedApps([])).resolves.toEqual({
      restarted: [],
      error: "No editor restart target selected"
    });
  });
});

describe("launch at startup service", () => {
  it("only updates Electron login item settings when the store value differs", () => {
    const updates: LoginItemSettings[] = [];
    const adapter = {
      enabled: false,
      getLoginItemSettings() {
        return { openAtLogin: this.enabled };
      },
      setLoginItemSettings(settings: LoginItemSettings) {
        updates.push(settings);
        this.enabled = settings.openAtLogin;
      }
    };
    const service = new LaunchAtStartupService(adapter);

    service.syncWithStoreValue(false);
    service.syncWithStoreValue(true);
    service.setEnabled(false);

    expect(updates).toEqual([{ openAtLogin: true }, { openAtLogin: false }]);
  });
});

describe("tray service", () => {
  it("renders tray actions and dispatches the selected command", async () => {
    const calls: TrayActionID[] = [];
    const adapter = new FakeTrayAdapter();
    const service = new TrayService({
      adapter,
      actions: trayActions(calls),
      initialState: { proxyRunning: false }
    });

    expect(adapter.tooltip).toBe("CodexManager");
    expect(menuLabels(adapter.items)).toEqual([
      "Show Window",
      "Refresh Accounts",
      "Smart Switch",
      "Start Proxy",
      "Quit"
    ]);

    adapter.click("startProxy");
    adapter.primaryClick();
    await Promise.resolve();
    expect(calls).toEqual(["startProxy", "showWindow"]);

    service.updateState({ proxyRunning: true });
    expect(menuLabels(adapter.items)).toContain("Stop Proxy");
  });

  it("disables non-quit actions while busy", () => {
    const adapter = new FakeTrayAdapter();
    new TrayService({
      adapter,
      actions: trayActions([]),
      initialState: { busy: true, proxyRunning: true }
    });

    expect(adapter.enabledState("refreshAccounts")).toBe(false);
    expect(adapter.enabledState("smartSwitch")).toBe(false);
    expect(adapter.enabledState("stopProxy")).toBe(false);
    expect(adapter.enabledState("quit")).toBe(true);
  });

  it("reports asynchronous action failures", async () => {
    const errors: Array<{ action: TrayActionID; message: string }> = [];
    const adapter = new FakeTrayAdapter();
    new TrayService({
      adapter,
      actions: {
        ...trayActions([]),
        async smartSwitch() {
          throw new Error("switch failed");
        }
      },
      onActionError(action, error) {
        errors.push({ action, message: error instanceof Error ? error.message : String(error) });
      }
    });

    adapter.click("smartSwitch");
    await Promise.resolve();

    expect(errors).toEqual([{ action: "smartSwitch", message: "switch failed" }]);
  });
});

interface CommandCall {
  launchPath: string;
  argumentsList: string[];
}

interface DetachedLaunchCall {
  launchPath: string;
  argumentsList: string[];
  environmentPath: string | undefined;
}

function existingPathSet(paths: readonly string[]): (path: string) => boolean {
  const normalized = new Set(paths.map((path) => path.toLowerCase()));
  return (path) => normalized.has(path.toLowerCase());
}

function successfulRunner() {
  return async (): Promise<CommandResult> => ({ status: 0, stdout: "", stderr: "" });
}

function recordingRunner(commands: CommandCall[]) {
  return async (launchPath: string, argumentsList: readonly string[] = []): Promise<CommandResult> => {
    commands.push({ launchPath, argumentsList: [...argumentsList] });
    return { status: 0, stdout: "", stderr: "" };
  };
}

function recordingLauncher(launched: DetachedLaunchCall[]) {
  return async (
    launchPath: string,
    argumentsList: readonly string[] = [],
    options?: DetachedLaunchOptions
  ): Promise<void> => {
    launched.push({
      launchPath,
      argumentsList: [...argumentsList],
      environmentPath: options?.environment?.PATH ?? options?.environment?.Path
    });
  };
}

class FakeTrayAdapter {
  public items: readonly TrayMenuItem[] = [];
  public tooltip = "";
  private primaryClickHandler: (() => void) | undefined;

  setToolTip(value: string): void {
    this.tooltip = value;
  }

  setContextMenu(items: readonly TrayMenuItem[]): void {
    this.items = items;
  }

  onPrimaryClick(handler: () => void): void {
    this.primaryClickHandler = handler;
  }

  click(id: TrayActionID): void {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.enabled === false) {
      throw new Error(`Tray item ${id} is not clickable`);
    }
    item.click?.();
  }

  enabledState(id: TrayActionID): boolean | undefined {
    return this.items.find((candidate) => candidate.id === id)?.enabled;
  }

  primaryClick(): void {
    this.primaryClickHandler?.();
  }
}

function trayActions(calls: TrayActionID[]) {
  return {
    showWindow() {
      calls.push("showWindow");
    },
    refreshAccounts() {
      calls.push("refreshAccounts");
    },
    smartSwitch() {
      calls.push("smartSwitch");
    },
    startProxy() {
      calls.push("startProxy");
    },
    stopProxy() {
      calls.push("stopProxy");
    },
    quit() {
      calls.push("quit");
    }
  };
}

function menuLabels(items: readonly TrayMenuItem[]): string[] {
  return items.flatMap((item) => (item.label ? [item.label] : []));
}
