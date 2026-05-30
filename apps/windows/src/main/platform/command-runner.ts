import { spawn, type SpawnOptions } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter as hostPathDelimiter, dirname, extname, isAbsolute, join, win32 } from "node:path";

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunOptions {
  currentDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export interface DetachedLaunchOptions {
  currentDirectory?: string;
  environment?: NodeJS.ProcessEnv;
}

export interface ResolveExecutableOptions {
  environment?: NodeJS.ProcessEnv;
  executableExists?: (path: string) => boolean;
  pathDelimiter?: string;
  pathExtensions?: readonly string[];
}

export class CommandTimeoutError extends Error {
  constructor(commandLine: string, timeoutMs: number) {
    super(`Command timed out after ${timeoutMs}ms: ${commandLine}`);
    this.name = "CommandTimeoutError";
  }
}

export class CommandExecutionError extends Error {
  constructor(message: string, readonly result: CommandResult) {
    super(message);
    this.name = "CommandExecutionError";
  }
}

const defaultMaxOutputBytes = 8 * 1024;
const forceKillDelayMs = 1_200;
const defaultWindowsPathExtensions = [".exe", ".cmd", ".bat", ".ps1"] as const;

export async function runCommand(
  launchPath: string,
  argumentsList: readonly string[] = [],
  options: CommandRunOptions = {}
): Promise<CommandResult> {
  const maxOutputBytes = options.maxOutputBytes ?? defaultMaxOutputBytes;
  const stdout = new BoundedTextBuffer(maxOutputBytes);
  const stderr = new BoundedTextBuffer(maxOutputBytes);
  const spawnOptions = commandSpawnOptions(options);
  const child = spawn(launchPath, [...argumentsList], spawnOptions);
  const commandLine = formatCommandLine(launchPath, argumentsList);

  return new Promise<CommandResult>((resolve, reject) => {
    let timeoutHandle: NodeJS.Timeout | undefined;
    let forceKillHandle: NodeJS.Timeout | undefined;
    let timedOut = false;
    let settled = false;

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
      }
    };

    const settle = (operation: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      operation();
    };

    child.once("error", (error) => {
      settle(() => reject(error));
    });

    child.once("close", (status) => {
      settle(() => {
        if (timedOut) {
          reject(new CommandTimeoutError(commandLine, options.timeoutMs ?? 0));
          return;
        }
        resolve({
          status: status ?? -1,
          stdout: stdout.toString(),
          stderr: stderr.toString()
        });
      });
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout.append(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr.append(chunk);
    });

    if (options.timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill();
        forceKillHandle = setTimeout(() => {
          if (!settled) {
            child.kill("SIGKILL");
          }
        }, forceKillDelayMs);
      }, options.timeoutMs);
    }
  });
}

export async function runChecked(
  launchPath: string,
  argumentsList: readonly string[] = [],
  options: CommandRunOptions & { errorPrefix: string }
): Promise<CommandResult> {
  const result = await runCommand(launchPath, argumentsList, options);
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout).trim();
    throw new CommandExecutionError(`${options.errorPrefix}: ${details}`, result);
  }
  return result;
}

export async function launchDetached(
  launchPath: string,
  argumentsList: readonly string[] = [],
  options: DetachedLaunchOptions = {}
): Promise<void> {
  const spawnOptions: SpawnOptions = {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  };
  if (options.currentDirectory) {
    spawnOptions.cwd = options.currentDirectory;
  }
  if (options.environment) {
    spawnOptions.env = options.environment;
  }

  const child = spawn(launchPath, [...argumentsList], spawnOptions);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (operation: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      operation();
    };

    child.once("error", (error) => {
      settle(() => reject(error));
    });
    child.once("spawn", () => {
      child.unref();
      settle(resolve);
    });
  });
}

export function resolveExecutable(name: string, options: ResolveExecutableOptions = {}): string | undefined {
  const environment = options.environment ?? process.env;
  const executableExists = options.executableExists ?? defaultExecutableExists;
  const pathDelimiter = options.pathDelimiter ?? inferPathDelimiter(environment);
  const windowsStyle = pathDelimiter === ";";
  const candidateNames = executableCandidateNames(
    name,
    options.pathExtensions ?? pathExtensionsForEnvironment(environment, windowsStyle)
  );

  if (containsPathSeparator(name) || isAbsolute(name)) {
    return candidateNames.find(executableExists);
  }

  for (const base of searchPathEntries(environment, pathDelimiter)) {
    for (const candidateName of candidateNames) {
      const candidate = windowsStyle ? win32.join(base, candidateName) : join(base, candidateName);
      if (executableExists(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export function environmentWithPrependedPath(
  path: string,
  environment: NodeJS.ProcessEnv = process.env,
  pathDelimiter = inferPathDelimiter(environment)
): NodeJS.ProcessEnv {
  const nextEnvironment: NodeJS.ProcessEnv = { ...environment };
  const pathKey = pathEnvironmentKey(nextEnvironment);
  const currentPath = nextEnvironment[pathKey] ?? "";
  nextEnvironment[pathKey] = currentPath ? `${path}${pathDelimiter}${currentPath}` : path;
  return nextEnvironment;
}

function commandSpawnOptions(options: CommandRunOptions): SpawnOptions {
  const spawnOptions: SpawnOptions = {
    windowsHide: true
  };
  if (options.currentDirectory) {
    spawnOptions.cwd = options.currentDirectory;
  }
  if (options.environment) {
    spawnOptions.env = options.environment;
  }
  return spawnOptions;
}

function inferPathDelimiter(environment: NodeJS.ProcessEnv): string {
  const pathValue = pathEnvironmentValue(environment);
  if (pathValue.includes(";")) {
    return ";";
  }
  return hostPathDelimiter;
}

function pathExtensionsForEnvironment(environment: NodeJS.ProcessEnv, windowsStyle: boolean): readonly string[] {
  if (!windowsStyle) {
    return [""];
  }
  const pathExt = environmentValue(environment, "PATHEXT");
  if (!pathExt) {
    return defaultWindowsPathExtensions;
  }
  const values = pathExt
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : defaultWindowsPathExtensions;
}

function executableCandidateNames(name: string, pathExtensions: readonly string[]): string[] {
  if (extname(name)) {
    return [name];
  }
  const candidates = [name];
  for (const pathExtension of pathExtensions) {
    if (!pathExtension) {
      continue;
    }
    candidates.push(`${name}${pathExtension}`);
  }
  return candidates;
}

function searchPathEntries(environment: NodeJS.ProcessEnv, pathDelimiter: string): string[] {
  return pathEnvironmentValue(environment)
    .split(pathDelimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function pathEnvironmentValue(environment: NodeJS.ProcessEnv): string {
  return environment[pathEnvironmentKey(environment)] ?? "";
}

function pathEnvironmentKey(environment: NodeJS.ProcessEnv): string {
  const key = Object.keys(environment).find((candidate) => candidate.toUpperCase() === "PATH");
  return key ?? "PATH";
}

function environmentValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  return environment[Object.keys(environment).find((candidate) => candidate.toUpperCase() === key.toUpperCase()) ?? key];
}

function containsPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function defaultExecutableExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function formatCommandLine(launchPath: string, argumentsList: readonly string[]): string {
  return [launchPath, ...argumentsList].join(" ");
}

class BoundedTextBuffer {
  private bytes: Buffer = Buffer.alloc(0);

  constructor(private readonly maxBytes: number) {}

  append(chunk: Buffer | string): void {
    if (this.maxBytes <= 0) {
      return;
    }
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (bytes.length >= this.maxBytes) {
      this.bytes = bytes.subarray(bytes.length - this.maxBytes);
      return;
    }
    if (this.bytes.length + bytes.length <= this.maxBytes) {
      this.bytes = Buffer.concat([this.bytes, bytes]);
      return;
    }
    const combined = Buffer.concat([this.bytes, bytes]);
    this.bytes = combined.subarray(combined.length - this.maxBytes);
  }

  toString(): string {
    return this.bytes.toString("utf8");
  }
}

export function parentDirectoryForPath(path: string, windowsStyle = path.includes("\\")): string {
  return windowsStyle ? win32.dirname(path) : dirname(path);
}
