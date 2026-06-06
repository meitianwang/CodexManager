import { readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import {
  environmentWithPrependedPath,
  launchDetached,
  parentDirectoryForPath,
  resolveExecutable,
  runChecked,
  runCommand,
  type CommandResult,
  type CommandRunOptions,
  type DetachedLaunchOptions
} from "../command-runner";

const codexProcessNames = ["Codex", "Codex Desktop"] as const;
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

export interface MacOSCodexCLIServiceDependencies {
  environment?: NodeJS.ProcessEnv;
  executableExists?: (path: string) => boolean;
  launchDetached?: LaunchDetached;
  pathExists?: (path: string) => boolean;
  runCommand?: RunCommand;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class MacOSCodexCLIService {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly executableExists: (path: string) => boolean;
  private readonly launchDetached: LaunchDetached;
  private readonly pathExists: (path: string) => boolean;
  private readonly runCommand: RunCommand;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(dependencies: MacOSCodexCLIServiceDependencies = {}) {
    this.environment = dependencies.environment ?? process.env;
    this.executableExists = dependencies.executableExists ?? defaultExecutableExists;
    this.launchDetached = dependencies.launchDetached ?? launchDetached;
    this.pathExists = dependencies.pathExists ?? defaultPathExists;
    this.runCommand = dependencies.runCommand ?? runCommand;
    this.sleep = dependencies.sleep ?? defaultSleep;
  }

  async launchApp(workspacePath?: string): Promise<boolean> {
    let appLaunchError: string | undefined;
    const appPath = await this.findCodexAppPath();
    if (appPath) {
      try {
        await runCheckedWithRunner(this.runCommand, "/usr/bin/open", ["-a", appPath, ...workspaceArguments(workspacePath)], {
          errorPrefix: "Failed to launch Codex desktop app",
          timeoutMs: 5_000
        });
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

  findCodexCLIPath(): string {
    const fromPath = resolveExecutable("codex", {
      environment: this.environment,
      executableExists: this.executableExists,
      pathDelimiter: ":",
      pathExtensions: [""]
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

  async findCodexAppPath(): Promise<string | undefined> {
    const fromCandidates = this.codexAppCandidatePaths().find(this.pathExists);
    if (fromCandidates) {
      return fromCandidates;
    }

    return (await this.findAppWithSpotlight("Codex.app")) ?? (await this.findAppWithSpotlight("Codex Desktop.app"));
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
        const result = await this.runCommand("/usr/bin/pgrep", ["-x", processName], {
          maxOutputBytes: 2_048,
          timeoutMs: 1_500
        });
        if (result.status === 0) {
          return true;
        }
      } catch {
        // Absence or pgrep failure should let the launcher fall back to the CLI path.
      }
    }
    return false;
  }

  private async launchViaCodexCLI(workspacePath?: string): Promise<void> {
    const codexPath = this.findCodexCLIPath();
    const environment = environmentWithPrependedPath(parentDirectoryForPath(codexPath, false), this.environment, ":");
    await this.launchDetached(codexPath, ["app", ...workspaceArguments(workspacePath)], { environment });
  }

  private codexAppCandidatePaths(): string[] {
    const home = homeDirectory(this.environment);
    return uniqueStrings([
      "/Applications/Codex.app",
      "/Applications/Codex Desktop.app",
      home ? posix.join(home, "Applications", "Codex.app") : undefined,
      home ? posix.join(home, "Applications", "Codex Desktop.app") : undefined
    ]);
  }

  private codexCLICandidatePaths(): string[] {
    const home = homeDirectory(this.environment);
    const appPath = this.codexAppCandidatePaths().find(this.pathExists);
    return uniqueStrings([
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      "/usr/bin/codex",
      home ? posix.join(home, ".local", "bin", "codex") : undefined,
      home ? posix.join(home, ".npm-global", "bin", "codex") : undefined,
      home ? posix.join(home, ".volta", "bin", "codex") : undefined,
      home ? posix.join(home, ".asdf", "shims", "codex") : undefined,
      home ? posix.join(home, "Library", "pnpm", "codex") : undefined,
      home ? posix.join(home, "bin", "codex") : undefined,
      appPath ? posix.join(appPath, "Contents", "Resources", "codex") : undefined,
      ...this.nvmCodexCandidatePaths(home)
    ]);
  }

  private nvmCodexCandidatePaths(home: string | undefined): string[] {
    if (!home) {
      return [];
    }
    const versionsDirectory = posix.join(home, ".nvm", "versions", "node");
    try {
      return readdirSync(versionsDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse()
        .map((version) => posix.join(versionsDirectory, version, "bin", "codex"));
    } catch {
      return [];
    }
  }

  private async findAppWithSpotlight(appName: string): Promise<string | undefined> {
    try {
      const result = await this.runCommand("/usr/bin/mdfind", [`kMDItemFSName == '${appName}'`], {
        maxOutputBytes: 8_192,
        timeoutMs: 2_000
      });
      if (result.status !== 0) {
        return undefined;
      }
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((path) => path.length > 0 && this.pathExists(path));
    } catch {
      return undefined;
    }
  }
}

function workspaceArguments(workspacePath?: string): string[] {
  return workspacePath && workspacePath.length > 0 ? [workspacePath] : [];
}

async function runCheckedWithRunner(
  runner: RunCommand,
  launchPath: string,
  argumentsList: readonly string[],
  options: CommandRunOptions & { errorPrefix: string }
): Promise<CommandResult> {
  if (runner === runCommand) {
    return runChecked(launchPath, argumentsList, options);
  }
  const result = await runner(launchPath, argumentsList, options);
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout).trim();
    throw new Error(`${options.errorPrefix}: ${details}`);
  }
  return result;
}

function homeDirectory(environment: NodeJS.ProcessEnv): string | undefined {
  return environment.HOME;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultPathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function defaultExecutableExists(path: string): boolean {
  try {
    const stats = statSync(path);
    return stats.isFile() && Boolean(stats.mode & 0o111);
  } catch {
    return false;
  }
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
