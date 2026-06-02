import { statSync } from "node:fs";
import { posix } from "node:path";
import type { InstalledEditorApp } from "../../../shared/models/app";
import type { EditorAppID } from "../../../shared/models/settings";
import {
  runChecked,
  runCommand,
  type CommandResult,
  type CommandRunOptions
} from "../command-runner";

type RunCommand = (
  launchPath: string,
  argumentsList?: readonly string[],
  options?: CommandRunOptions
) => Promise<CommandResult>;

interface EditorSpec {
  id: EditorAppID;
  label: string;
  bundleNames: readonly string[];
  processNames: readonly string[];
}

export interface MacOSEditorAppServiceDependencies {
  bundleExists?: (path: string) => boolean;
  environment?: NodeJS.ProcessEnv;
  runCommand?: RunCommand;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface EditorRestartResult {
  restarted: EditorAppID[];
  error?: string;
}

const editorSpecs: readonly EditorSpec[] = [
  {
    id: "vscode",
    label: "VS Code",
    bundleNames: ["Visual Studio Code.app", "Code.app"],
    processNames: ["Code", "Visual Studio Code"]
  },
  {
    id: "vscodeInsiders",
    label: "Visual Studio Code - Insiders",
    bundleNames: ["Visual Studio Code - Insiders.app", "Code - Insiders.app"],
    processNames: ["Code - Insiders", "Visual Studio Code - Insiders"]
  },
  {
    id: "cursor",
    label: "Cursor",
    bundleNames: ["Cursor.app"],
    processNames: ["Cursor"]
  },
  {
    id: "antigravity",
    label: "Antigravity",
    bundleNames: ["Antigravity.app", "Antigravity IDE.app"],
    processNames: ["Antigravity", "Antigravity IDE"]
  },
  {
    id: "kiro",
    label: "Kiro",
    bundleNames: ["Kiro.app"],
    processNames: ["Kiro"]
  },
  {
    id: "trae",
    label: "Trae",
    bundleNames: ["Trae.app"],
    processNames: ["Trae"]
  },
  {
    id: "qoder",
    label: "Qoder",
    bundleNames: ["Qoder.app"],
    processNames: ["Qoder"]
  }
];

export class MacOSEditorAppService {
  private readonly bundleExists: (path: string) => boolean;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly runCommand: RunCommand;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(dependencies: MacOSEditorAppServiceDependencies = {}) {
    this.bundleExists = dependencies.bundleExists ?? defaultBundleExists;
    this.environment = dependencies.environment ?? process.env;
    this.runCommand = dependencies.runCommand ?? runCommand;
    this.sleep = dependencies.sleep ?? defaultSleep;
  }

  listInstalledApps(): InstalledEditorApp[] {
    return editorSpecs.flatMap((spec) => {
      if (!this.resolveBundlePath(spec)) {
        return [];
      }
      return [{ id: spec.id, label: spec.label }];
    });
  }

  async restartSelectedApps(targets: readonly EditorAppID[]): Promise<EditorRestartResult> {
    if (targets.length === 0) {
      return { restarted: [], error: "No editor restart target selected" };
    }

    const restarted: EditorAppID[] = [];
    const errors: string[] = [];

    for (const target of targets) {
      const spec = editorSpecs.find((candidate) => candidate.id === target);
      if (!spec) {
        errors.push(`Unknown editor id: ${target}`);
        continue;
      }

      try {
        const bundlePath = this.requireBundlePath(spec);
        await this.forceKillProcesses(spec.processNames);
        await this.sleep(220);
        await runCheckedWithRunner(this.runCommand, "/usr/bin/open", ["-na", bundlePath], {
          errorPrefix: "Failed to restart editor app",
          timeoutMs: 5_000
        });
        restarted.push(spec.id);
      } catch (error) {
        errors.push(`${spec.label}: ${errorMessage(error)}`);
      }
    }

    return {
      restarted,
      error: errors.length > 0 ? errors.join(" | ") : undefined
    };
  }

  private requireBundlePath(spec: EditorSpec): string {
    const bundlePath = this.resolveBundlePath(spec);
    if (!bundlePath) {
      throw new Error("Installation path was not found");
    }
    return bundlePath;
  }

  private resolveBundlePath(spec: EditorSpec): string | undefined {
    return this.bundleCandidatePaths(spec).find(this.bundleExists);
  }

  private bundleCandidatePaths(spec: EditorSpec): string[] {
    const roots = ["/Applications", homeDirectory(this.environment) ? posix.join(homeDirectory(this.environment)!, "Applications") : undefined]
      .filter((value): value is string => value !== undefined);
    const candidates: string[] = [];
    for (const root of roots) {
      for (const bundleName of spec.bundleNames) {
        candidates.push(posix.join(root, bundleName));
      }
    }
    return candidates;
  }

  private async forceKillProcesses(processNames: readonly string[]): Promise<void> {
    await Promise.all(
      processNames.map(async (processName) => {
        try {
          await this.runCommand("/usr/bin/pkill", ["-9", "-x", processName], { timeoutMs: 1_500 });
        } catch {
          // pkill exits non-zero when the editor is not running; restart can continue.
        }
      })
    );
  }
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

function defaultBundleExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
