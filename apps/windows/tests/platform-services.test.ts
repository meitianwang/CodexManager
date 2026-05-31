import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
import {
  LaunchAtStartupService,
  type LoginItemSettings,
  type LoginItemSettingsOptions
} from "../src/main/platform/launch-at-startup-service";
import { TrayService, type TrayActionID, type TrayMenuItem } from "../src/main/platform/tray-service";
import type { AccountSummary } from "../src/shared/models/accounts";
import { appLocales, type AppLocaleID } from "../src/shared/models/settings";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const macTrayLocalizedLocales = ["en", "zh-Hans", "ja", "ko"] as const satisfies readonly AppLocaleID[];

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
      execPath: String.raw`C:\Users\me\AppData\Local\CodexManager\app-0.1.0\CodexManager.exe`,
      isPackaged: true,
      platform: "win32"
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

  it("keeps shared tray labels aligned with macOS localizations", () => {
    for (const locale of macTrayLocalizedLocales) {
      const macMessages = readMacLocalization(locale);
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
      expect(labels, locale).toContain(requiredMacMessage(macMessages, "tray.action.open_panel"));
      expect(labels, locale).toContain(requiredMacMessage(macMessages, "tray.action.quit"));
      expect(labels, locale).toContain(
        formatMacMessage(requiredMacMessage(macMessages, "tray.status.current_format"), "user@example.com")
      );
      expect(labels, locale).toContain(
        formatMacMessage(requiredMacMessage(macMessages, "tray.status.accounts_count_format"), "1")
      );
      expect(labels, locale).toContain(
        formatMacMessage(requiredMacMessage(macMessages, "tray.status.remaining_format"), "88%")
      );
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

function readMacLocalization(locale: string): Map<string, string> {
  const stringsPath = resolve(repositoryRoot, "Sources/CodexManager/Resources", `${locale}.lproj`, "Localizable.strings");
  const contents = readFileSync(stringsPath, "utf8");
  const messages = new Map<string, string>();
  const pattern = /"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)";/g;
  for (const match of contents.matchAll(pattern)) {
    messages.set(unescapeAppleString(match[1] ?? ""), unescapeAppleString(match[2] ?? ""));
  }
  return messages;
}

function unescapeAppleString(value: string): string {
  return value
    .replaceAll("\\\\", "\\")
    .replaceAll('\\"', '"')
    .replaceAll("\\n", "\n");
}

function requiredMacMessage(messages: ReadonlyMap<string, string>, key: string): string {
  const message = messages.get(key);
  if (message === undefined) {
    throw new Error(`Expected macOS tray localization ${key} was not found`);
  }
  return message;
}

function formatMacMessage(template: string, value: string): string {
  return template.replace("%@", value);
}
