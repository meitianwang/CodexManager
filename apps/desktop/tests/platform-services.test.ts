import { describe, expect, it } from "vitest";
import {
  CommandTimeoutError,
  environmentWithPrependedPath,
  resolveExecutable,
  runCommand,
  type CommandResult,
  type DetachedLaunchOptions
} from "../src/main/platform/command-runner";
import {
  LaunchAtStartupService,
  type LoginItemSettings,
  type LoginItemSettingsOptions
} from "../src/main/platform/launch-at-startup-service";
import { TrayService, type TrayActionID, type TrayMenuItem } from "../src/main/platform/tray-service";
import { createDesktopPlatform } from "../src/main/platform";
import { MacOSCodexCLIService } from "../src/main/platform/macos/codex-cli-service";
import { MacOSEditorAppService } from "../src/main/platform/macos/editor-app-service";
import { CodexCLIService } from "../src/main/platform/windows/codex-cli-service";
import { EditorAppService } from "../src/main/platform/windows/editor-app-service";
import { windowsSquirrelLoginItemTarget } from "../src/main/platform/windows/launch-at-startup";
import type { AccountSummary } from "../src/shared/models/accounts";
import { appLocales, type AppLocaleID } from "../src/shared/models/settings";

const localizedTrayContractCases = [
  {
    locale: "en",
    labels: ["Open Main Panel", "Quit", "Using: user@example.com", "1 accounts", "88% remaining"]
  },
  {
    locale: "zh-Hans",
    labels: ["打开主面板", "退出", "正在使用：user@example.com", "1 个账号", "剩余 88%"]
  },
  {
    locale: "ja",
    labels: ["メインパネルを開く", "終了", "使用中: user@example.com", "1 個のアカウント", "残り 88%"]
  },
  {
    locale: "ko",
    labels: ["메인 패널 열기", "종료", "사용 중: user@example.com", "1개 계정", "88% 남음"]
  }
] satisfies ReadonlyArray<{ labels: readonly string[]; locale: AppLocaleID }>;

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
    const commands: CommandCall[] = [];
    const launched: DetachedLaunchCall[] = [];
    const service = new CodexCLIService({
      environment: {
        LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local`,
        PATH: ""
      },
      executableExists: existingPathSet([codexApp]),
      launchDetached: recordingLauncher(launched),
      runCommand: codexProcessRunner(commands, true),
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
    expect(commands.some((command) => command.launchPath === "tasklist")).toBe(true);
    expect(commands.some((command) => command.launchPath === "taskkill")).toBe(false);
  });

  it("falls back to codex app when the desktop process does not appear after launch", async () => {
    const codexApp = String.raw`C:\Users\me\AppData\Local\Programs\Codex\Codex.exe`;
    const codexCLI = String.raw`C:\Users\me\AppData\Roaming\npm\codex.cmd`;
    const commands: CommandCall[] = [];
    const launched: DetachedLaunchCall[] = [];
    const service = new CodexCLIService({
      environment: {
        APPDATA: String.raw`C:\Users\me\AppData\Roaming`,
        LOCALAPPDATA: String.raw`C:\Users\me\AppData\Local`,
        Path: String.raw`C:\Windows\System32`
      },
      executableExists: existingPathSet([codexApp, codexCLI]),
      launchDetached: recordingLauncher(launched),
      runCommand: codexProcessRunner(commands, false),
      sleep: async () => undefined
    });

    await expect(service.launchApp(String.raw`C:\workspaces\demo`)).resolves.toBe(true);
    expect(launched).toEqual([
      {
        launchPath: codexApp,
        argumentsList: [String.raw`C:\workspaces\demo`],
        environmentPath: undefined
      },
      {
        launchPath: codexCLI,
        argumentsList: ["app", String.raw`C:\workspaces\demo`],
        environmentPath: String.raw`C:\Users\me\AppData\Roaming\npm;C:\Windows\System32`
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

describe("macOS Codex CLI service", () => {
  it("launches the desktop app bundle when Codex.app is installed", async () => {
    const commands: CommandCall[] = [];
    const launched: DetachedLaunchCall[] = [];
    const service = new MacOSCodexCLIService({
      environment: {
        HOME: "/Users/me",
        PATH: ""
      },
      executableExists: existingPathSet([]),
      launchDetached: recordingLauncher(launched),
      pathExists: existingPathSet(["/Applications/Codex.app"]),
      runCommand: macCodexProcessRunner(commands, true),
      sleep: async () => undefined
    });

    await expect(service.launchApp("/workspaces/demo")).resolves.toBe(false);
    expect(launched).toEqual([]);
    expect(commands).toContainEqual({
      launchPath: "/usr/bin/open",
      argumentsList: ["-a", "/Applications/Codex.app", "/workspaces/demo"]
    });
    expect(commands.some((command) => command.launchPath === "/usr/bin/pgrep")).toBe(true);
    expect(commands.some((command) => command.launchPath === "/usr/bin/pkill")).toBe(false);
  });

  it("falls back to codex app through the CLI when the macOS app bundle is unavailable", async () => {
    const launched: DetachedLaunchCall[] = [];
    const service = new MacOSCodexCLIService({
      environment: {
        HOME: "/Users/me",
        PATH: ""
      },
      executableExists: existingPathSet(["/opt/homebrew/bin/codex"]),
      launchDetached: recordingLauncher(launched),
      pathExists: existingPathSet([]),
      runCommand: successfulRunner(),
      sleep: async () => undefined
    });

    await expect(service.launchApp("/workspaces/demo")).resolves.toBe(true);
    expect(launched).toEqual([
      {
        launchPath: "/opt/homebrew/bin/codex",
        argumentsList: ["app", "/workspaces/demo"],
        environmentPath: "/opt/homebrew/bin"
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

  it("does not relaunch a Windows editor when taskkill fails for a real error", async () => {
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
      runCommand: async (launchPath: string, argumentsList: readonly string[] = []) => {
        commands.push({ launchPath, argumentsList: [...argumentsList] });
        return { status: 5, stdout: "", stderr: "Access is denied." };
      },
      sleep: async () => undefined
    });

    await expect(service.restartSelectedApps(["cursor"])).resolves.toEqual({
      restarted: [],
      error: "Cursor: Failed to stop editor process Cursor.exe: Access is denied."
    });
    expect(commands).toEqual([{ launchPath: "taskkill", argumentsList: ["/IM", "Cursor.exe", "/F", "/T"] }]);
    expect(launched).toEqual([]);
  });

  it("reports an error when no restart targets are selected", async () => {
    const service = new EditorAppService();

    await expect(service.restartSelectedApps([])).resolves.toEqual({
      restarted: [],
      error: "No editor restart target selected"
    });
  });
});

describe("macOS editor app service", () => {
  it("lists installed macOS editors from system and user Applications directories", () => {
    const service = new MacOSEditorAppService({
      bundleExists: existingPathSet(["/Applications/Visual Studio Code.app", "/Users/me/Applications/Cursor.app"]),
      environment: {
        HOME: "/Users/me"
      }
    });

    expect(service.listInstalledApps()).toEqual([
      { id: "vscode", label: "VS Code" },
      { id: "cursor", label: "Cursor" }
    ]);
  });

  it("restarts selected macOS editors with pkill and open", async () => {
    const commands: CommandCall[] = [];
    const service = new MacOSEditorAppService({
      bundleExists: existingPathSet(["/Users/me/Applications/Cursor.app"]),
      environment: {
        HOME: "/Users/me"
      },
      runCommand: recordingRunner(commands),
      sleep: async () => undefined
    });

    await expect(service.restartSelectedApps(["cursor"])).resolves.toEqual({
      restarted: ["cursor"],
      error: undefined
    });
    expect(commands).toEqual([
      { launchPath: "/usr/bin/pkill", argumentsList: ["-9", "-x", "Cursor"] },
      { launchPath: "/usr/bin/open", argumentsList: ["-na", "/Users/me/Applications/Cursor.app"] }
    ]);
  });

  it("does not relaunch a macOS editor when pkill fails for a real error", async () => {
    const commands: CommandCall[] = [];
    const service = new MacOSEditorAppService({
      bundleExists: existingPathSet(["/Users/me/Applications/Cursor.app"]),
      environment: {
        HOME: "/Users/me"
      },
      runCommand: async (launchPath: string, argumentsList: readonly string[] = []) => {
        commands.push({ launchPath, argumentsList: [...argumentsList] });
        return { status: launchPath === "/usr/bin/pkill" ? 3 : 0, stdout: "", stderr: "operation not permitted" };
      },
      sleep: async () => undefined
    });

    await expect(service.restartSelectedApps(["cursor"])).resolves.toEqual({
      restarted: [],
      error: "Cursor: Failed to stop editor process Cursor: operation not permitted"
    });
    expect(commands).toEqual([{ launchPath: "/usr/bin/pkill", argumentsList: ["-9", "-x", "Cursor"] }]);
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

  it("uses the Squirrel Update.exe stub for packaged Windows login items", () => {
    const updates: LoginItemSettings[] = [];
    const observedOptions: Array<LoginItemSettingsOptions | undefined> = [];
    const adapter = {
      enabled: false,
      getLoginItemSettings(options?: LoginItemSettingsOptions) {
        observedOptions.push(options);
        return { openAtLogin: this.enabled };
      },
      setLoginItemSettings(settings: LoginItemSettings) {
        updates.push(settings);
        this.enabled = settings.openAtLogin;
      }
    };
    const target = {
      path: String.raw`C:\Users\me\AppData\Local\CodexManager\Update.exe`,
      args: ["--processStart", "CodexManager.exe"]
    };
    const service = new LaunchAtStartupService(adapter, {
      loginItemTarget: windowsSquirrelLoginItemTarget({
        execPath: String.raw`C:\Users\me\AppData\Local\CodexManager\app-0.1.0\CodexManager.exe`,
        isPackaged: true,
        platform: "win32"
      })
    });

    service.syncWithStoreValue(true);
    service.setEnabled(false);

    expect(observedOptions).toEqual([target]);
    expect(updates).toEqual([
      { openAtLogin: true, enabled: true, ...target },
      { openAtLogin: false, enabled: false, ...target }
    ]);
  });
});

describe("desktop platform selection", () => {
  it("selects platform adapters and source device ids for persisted desktop selections", () => {
    const app = new FakeElectronApp() as unknown as Parameters<typeof createDesktopPlatform>[0];
    const macos = createDesktopPlatform(app, "darwin");
    const windows = createDesktopPlatform(app, "win32");
    const linux = createDesktopPlatform(app, "linux");

    expect(macos.id).toBe("macos");
    expect(macos.lifecycle.quitOnWindowAllClosed).toBe(false);
    expect(macos.sourceDeviceID).toBe("macos-local");
    expect(macos.requestHeaders.codexToolsUserAgent).toBe("codex-tools-macos/0.1");
    expect(macos.requestHeaders.codexUpstreamUserAgent).toContain("(macOS; ");
    expect(macos.smokeDefaults.workspacePath).toBe("/tmp/smoke-workspace");
    expect(macos.windowOptions.iconAssetName).toBeUndefined();
    expect(windows.id).toBe("windows");
    expect(windows.lifecycle.quitOnWindowAllClosed).toBe(true);
    expect(windows.sourceDeviceID).toBe("windows-local");
    expect(windows.requestHeaders.codexToolsUserAgent).toBe("codex-tools-windows/0.1");
    expect(windows.requestHeaders.codexUpstreamUserAgent).toBe(
      "codex_cli_rs/0.116.0 (Windows 11; x64) CodexManager/0.1"
    );
    expect(windows.smokeDefaults.workspacePath).toBe("C:\\smoke-workspace");
    expect(windows.windowOptions.iconAssetName).toBe("icon.ico");
    expect(linux.id).toBe("linux");
    expect(linux.lifecycle.quitOnWindowAllClosed).toBe(true);
    expect(linux.sourceDeviceID).toBe("linux-unsupported");
    expect(linux.requestHeaders.codexToolsUserAgent).toBe("codex-tools-linux/0.1");
    expect(linux.requestHeaders.codexUpstreamUserAgent).toContain("(Linux; ");
    expect(linux.smokeDefaults.workspacePath).toBe("/tmp/smoke-workspace");
    expect(linux.windowOptions.iconAssetName).toBeUndefined();
    expect(() => linux.paths()).toThrow("Linux desktop platform is not supported yet");
  });

  it("does not route unsupported desktop platforms through the Windows adapter", () => {
    const app = new FakeElectronApp() as unknown as Parameters<typeof createDesktopPlatform>[0];

    expect(() => createDesktopPlatform(app, "freebsd")).toThrow("Unsupported desktop platform: freebsd");
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

    expect(adapter.tooltip).toBe("CodexManager - 5h -- / 1w --");
    expect(actionLabels(adapter.items)).toEqual([
      "Open Main Panel",
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

  it("localizes tray menu labels and rerenders after locale changes", () => {
    const adapter = new FakeTrayAdapter();
    const service = new TrayService({
      adapter,
      actions: trayActions([]),
      initialState: { locale: "zh-Hans", proxyRunning: false }
    });

    expect(menuLabels(adapter.items)).toContain("未选择账号");
    expect(menuLabels(adapter.items)).toContain("0 个账号");
    expect(actionLabels(adapter.items)).toEqual(["打开主面板", "刷新账号", "智能切换", "启动代理", "退出"]);

    service.updateState({ locale: "en", proxyRunning: true });
    expect(menuLabels(adapter.items)).toContain("No account selected");
    expect(menuLabels(adapter.items)).toContain("0 accounts");
    expect(actionLabels(adapter.items)).toEqual(["Open Main Panel", "Refresh Accounts", "Smart Switch", "Stop Proxy", "Quit"]);
  });

  it("renders account quota status and updates the tooltip", () => {
    const adapter = new FakeTrayAdapter();
    const currentAccount = accountSummary({
      email: "user@example.com",
      isCurrent: true,
      usage: {
        fetchedAt: 1,
        fiveHour: { usedPercent: 12.4, windowSeconds: 18_000 },
        oneWeek: { usedPercent: 45.2, windowSeconds: 604_800 }
      }
    });
    const service = new TrayService({
      adapter,
      actions: trayActions([]),
      initialState: { accounts: [currentAccount], proxyRunning: false }
    });

    expect(adapter.tooltip).toBe("CodexManager - 5h 88% / 1w 55%");
    expect(menuLabels(adapter.items)).toEqual([
      "Open Main Panel",
      "Using: user@example.com",
      "1 accounts",
      "88% remaining",
      "Refresh Accounts",
      "Smart Switch",
      "Start Proxy",
      "Quit"
    ]);

    service.updateState({
      accounts: [
        accountSummary({
          id: "second",
          label: "Second"
        })
      ]
    });
    expect(adapter.tooltip).toBe("CodexManager - 5h -- / 1w --");
    expect(menuLabels(adapter.items)).toContain("No account selected");
    expect(menuLabels(adapter.items)).toContain("1 accounts");
  });

  it("keeps localized tray labels stable for the desktop menu contract", () => {
    for (const { labels: expectedLabels, locale } of localizedTrayContractCases) {
      const adapter = new FakeTrayAdapter();
      new TrayService({
        adapter,
        actions: trayActions([]),
        initialState: {
          accounts: [
            accountSummary({
              email: "user@example.com",
              isCurrent: true,
              usage: {
                fetchedAt: 1,
                fiveHour: { usedPercent: 12.4, windowSeconds: 18_000 },
                oneWeek: { usedPercent: 45.2, windowSeconds: 604_800 }
              }
            })
          ],
          locale,
          proxyRunning: false
        }
      });

      const labels = menuLabels(adapter.items);
      for (const expectedLabel of expectedLabels) {
        expect(labels, locale).toContain(expectedLabel);
      }
    }
  });

  it("has non-empty tray menu labels for every supported locale", () => {
    for (const locale of appLocales) {
      const adapter = new FakeTrayAdapter();
      new TrayService({
        adapter,
        actions: trayActions([]),
        initialState: { locale, proxyRunning: false }
      });

      expect(menuLabels(adapter.items).every((label) => label.trim().length > 0), locale).toBe(true);
    }
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

function codexProcessRunner(commands: CommandCall[], processRunning: boolean) {
  return async (launchPath: string, argumentsList: readonly string[] = []): Promise<CommandResult> => {
    commands.push({ launchPath, argumentsList: [...argumentsList] });
    if (launchPath === "tasklist" && processRunning) {
      return { status: 0, stdout: "Codex.exe                    1234 Console                    1     80,000 K", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
}

function macCodexProcessRunner(commands: CommandCall[], processRunning: boolean) {
  return async (launchPath: string, argumentsList: readonly string[] = []): Promise<CommandResult> => {
    commands.push({ launchPath, argumentsList: [...argumentsList] });
    if (launchPath === "/usr/bin/pgrep" && processRunning) {
      return { status: 0, stdout: "1234\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
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

class FakeElectronApp {
  getLoginItemSettings(): { openAtLogin: boolean } {
    return { openAtLogin: false };
  }

  getPath(name: string): string {
    if (name === "appData") {
      return "/Users/me/Library/Application Support";
    }
    if (name === "home") {
      return "/Users/me";
    }
    return `/Users/me/${name}`;
  }

  setLoginItemSettings(): void {}
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

function actionLabels(items: readonly TrayMenuItem[]): string[] {
  return items.flatMap((item) => (item.id && item.label ? [item.label] : []));
}

function accountSummary(patch: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: "account",
    label: "Account",
    accountId: "acct",
    addedAt: 1,
    updatedAt: 1,
    isCurrent: false,
    accountKey: "acct",
    effectivePlanType: "pro",
    normalizedPlanLabel: "Pro",
    shouldDisplayWorkspaceTag: false,
    ...patch
  };
}
