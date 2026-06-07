import { statSync } from "node:fs";
import { win32 } from "node:path";
import {
  environmentWithPrependedPath,
  launchDetached,
  parentDirectoryForPath,
  resolveExecutable,
  runCommand,
  type CommandResult,
  type CommandRunOptions,
  type DetachedLaunchOptions
} from "../command-runner";
import {
  localAppDataDirectory,
  programFilesDirectories,
  roamingAppDataDirectory,
  uniqueStrings,
  userProfileDirectory
} from "./windows-environment";

const codexProcessNames = ["Codex.exe", "Codex Desktop.exe"] as const;
const codexProcessPollIntervalMs = 100;
const codexProcessLaunchTimeoutMs = 2_000;

type RunCommand = (
  launchPath: string,
  argumentsList?: readonly string[],
  options?: CommandRunOptions
) => Promise<CommandResult>;

type LaunchDetached = (
  launchPath: string,
  argumentsList?: readonly string[],
  options?: DetachedLaunchOptions
) => Promise<void>;

export interface CodexCLIServiceDependencies {
  environment?: NodeJS.ProcessEnv;
  executableExists?: (path: string) => boolean;
  launchDetached?: LaunchDetached;
  runCommand?: RunCommand;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class CodexCLIService {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly executableExists: (path: string) => boolean;
  private readonly launchDetached: LaunchDetached;
  private readonly runCommand: RunCommand;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(dependencies: CodexCLIServiceDependencies = {}) {
    this.environment = dependencies.environment ?? process.env;
    this.executableExists = dependencies.executableExists ?? defaultExecutableExists;
    this.launchDetached = dependencies.launchDetached ?? launchDetached;
    this.runCommand = dependencies.runCommand ?? runCommand;
    this.sleep = dependencies.sleep ?? defaultSleep;
  }

  async launchApp(workspacePath?: string): Promise<boolean> {
    let appLaunchError: string | undefined;
    const appPath = this.findCodexAppPath();
    if (appPath) {
      try {
        await this.launchDetached(appPath, workspaceArguments(workspacePath));
        if (await this.waitForCodexProcess(codexProcessLaunchTimeoutMs)) {
          return false;
        }
        appLaunchError = "Codex desktop process did not start";
      } catch (error) {
        appLaunchError = errorMessage(error);
      }
    }

    try {
      await this.launchViaCodexCLI(workspacePath);
      return true;
    } catch (error) {
      if (appLaunchError) {
        throw new Error(
          `Failed to launch Codex desktop app: ${appLaunchError} | Codex CLI fallback failed: ${errorMessage(error)}`
        );
      }
      throw error;
    }
  }

  async restartApp(workspacePath?: string): Promise<boolean> {
    await this.forceKillCodexProcesses();
    await this.sleep(220);
    return this.launchApp(workspacePath);
  }

  findCodexCLIPath(): string {
    const fromPath = resolveExecutable("codex", {
      environment: this.environment,
      executableExists: this.executableExists,
      pathDelimiter: ";"
    });
    if (fromPath) {
      return fromPath;
    }

    for (const candidate of this.codexCLICandidatePaths()) {
      if (this.executableExists(candidate)) {
        return candidate;
      }
    }

    throw new Error("Codex CLI executable was not found");
  }

  findCodexAppPath(): string | undefined {
    const fromPath = resolveExecutable("Codex", {
      environment: this.environment,
      executableExists: this.executableExists,
      pathDelimiter: ";",
      pathExtensions: [".exe"]
    });
    if (fromPath) {
      return fromPath;
    }

    return this.codexAppCandidatePaths().find(this.executableExists);
  }

  private async waitForCodexProcess(timeoutMs: number): Promise<boolean> {
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / codexProcessPollIntervalMs));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (await this.isCodexProcessRunning()) {
        return true;
      }
      await this.sleep(codexProcessPollIntervalMs);
    }
    return false;
  }

  private async isCodexProcessRunning(): Promise<boolean> {
    for (const processName of codexProcessNames) {
      try {
        const result = await this.runCommand("tasklist", ["/FI", `IMAGENAME eq ${processName}`, "/NH"], {
          maxOutputBytes: 2_048,
          timeoutMs: 1_500
        });
        if (result.status === 0 && taskListIncludesProcess(result.stdout, processName)) {
          return true;
        }
      } catch {
        // Absence or tasklist failure should let the launcher fall back to the CLI path.
      }
    }
    return false;
  }

  private async forceKillCodexProcesses(): Promise<void> {
    await Promise.all(
      codexProcessNames.map(async (processName) => {
        const result = await this.runCommand("taskkill", ["/IM", processName, "/F", "/T"], { timeoutMs: 1_500 });
        if (result.status === 0 || isTaskkillProcessAbsent(result)) {
          return;
        }
        throw new Error(`Failed to stop Codex process ${processName}: ${commandResultDetails(result)}`);
      })
    );
  }

  private async launchViaCodexCLI(workspacePath?: string): Promise<void> {
    const codexPath = this.findCodexCLIPath();
    const environment = environmentWithPrependedPath(parentDirectoryForPath(codexPath, true), this.environment, ";");
    await this.launchDetached(codexPath, ["app", ...workspaceArguments(workspacePath)], { environment });
  }

  private codexAppCandidatePaths(): string[] {
    const localAppData = localAppDataDirectory(this.environment);
    const programFiles = programFilesDirectories(this.environment);
    return uniqueStrings([
      localAppData ? win32.join(localAppData, "Programs", "Codex", "Codex.exe") : undefined,
      localAppData ? win32.join(localAppData, "Programs", "Codex Desktop", "Codex Desktop.exe") : undefined,
      localAppData ? win32.join(localAppData, "Codex", "Codex.exe") : undefined,
      ...programFiles.flatMap((base) => [
        win32.join(base, "Codex", "Codex.exe"),
        win32.join(base, "Codex Desktop", "Codex Desktop.exe")
      ])
    ]);
  }

  private codexCLICandidatePaths(): string[] {
    const userProfile = userProfileDirectory(this.environment);
    const localAppData = localAppDataDirectory(this.environment);
    const roamingAppData = roamingAppDataDirectory(this.environment);
    const appPath = this.findCodexAppPath();
    const stems = uniqueStrings([
      userProfile ? win32.join(userProfile, ".local", "bin", "codex") : undefined,
      userProfile ? win32.join(userProfile, ".npm-global", "codex") : undefined,
      userProfile ? win32.join(userProfile, ".volta", "bin", "codex") : undefined,
      userProfile ? win32.join(userProfile, "AppData", "Local", "pnpm", "codex") : undefined,
      roamingAppData ? win32.join(roamingAppData, "npm", "codex") : undefined,
      localAppData ? win32.join(localAppData, "pnpm", "codex") : undefined,
      localAppData ? win32.join(localAppData, "Programs", "nodejs", "codex") : undefined,
      appPath ? win32.join(win32.dirname(appPath), "resources", "codex") : undefined
    ]);

    return stems.flatMap((stem) => [`${stem}.cmd`, `${stem}.exe`, `${stem}.bat`, stem]);
  }
}

function workspaceArguments(workspacePath?: string): string[] {
  return workspacePath && workspacePath.length > 0 ? [workspacePath] : [];
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultExecutableExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function taskListIncludesProcess(stdout: string, processName: string): boolean {
  const expected = processName.toLowerCase();
  return stdout
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase().startsWith(expected));
}

function isTaskkillProcessAbsent(result: CommandResult): boolean {
  const details = `${result.stdout} ${result.stderr}`.toLowerCase();
  return result.status === 128 || details.includes("not found") || details.includes("no tasks are running");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function commandResultDetails(result: CommandResult): string {
  return (result.stderr || result.stdout).trim() || `exit status ${result.status}`;
}
