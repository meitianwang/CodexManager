import { statSync } from "node:fs";
import { win32 } from "node:path";
import type { InstalledEditorApp } from "../../../shared/models/app";
import type { EditorAppID } from "../../../shared/models/settings";
import {
  launchDetached,
  resolveExecutable,
  runCommand,
  type CommandResult,
  type CommandRunOptions,
  type DetachedLaunchOptions
} from "../command-runner";
import { localAppDataDirectory, programFilesDirectories, uniqueStrings } from "./windows-environment";

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

interface EditorSpec {
  id: EditorAppID;
  label: string;
  installDirectories: readonly string[];
  executableNames: readonly string[];
  processNames: readonly string[];
}

export interface EditorAppServiceDependencies {
  environment?: NodeJS.ProcessEnv;
  executableExists?: (path: string) => boolean;
  launchDetached?: LaunchDetached;
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
    installDirectories: ["Microsoft VS Code", "Visual Studio Code"],
    executableNames: ["Code.exe"],
    processNames: ["Code.exe"]
  },
  {
    id: "vscodeInsiders",
    label: "Visual Studio Code - Insiders",
    installDirectories: ["Microsoft VS Code Insiders", "Visual Studio Code - Insiders"],
    executableNames: ["Code - Insiders.exe"],
    processNames: ["Code - Insiders.exe"]
  },
  {
    id: "cursor",
    label: "Cursor",
    installDirectories: ["Cursor"],
    executableNames: ["Cursor.exe"],
    processNames: ["Cursor.exe"]
  },
  {
    id: "antigravity",
    label: "Antigravity",
    installDirectories: ["Antigravity", "Antigravity IDE"],
    executableNames: ["Antigravity.exe", "Antigravity IDE.exe"],
    processNames: ["Antigravity.exe", "Antigravity IDE.exe"]
  },
  {
    id: "kiro",
    label: "Kiro",
    installDirectories: ["Kiro"],
    executableNames: ["Kiro.exe"],
    processNames: ["Kiro.exe"]
  },
  {
    id: "trae",
    label: "Trae",
    installDirectories: ["Trae"],
    executableNames: ["Trae.exe"],
    processNames: ["Trae.exe"]
  },
  {
    id: "qoder",
    label: "Qoder",
    installDirectories: ["Qoder"],
    executableNames: ["Qoder.exe"],
    processNames: ["Qoder.exe"]
  }
];

export class EditorAppService {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly executableExists: (path: string) => boolean;
  private readonly launchDetached: LaunchDetached;
  private readonly runCommand: RunCommand;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(dependencies: EditorAppServiceDependencies = {}) {
    this.environment = dependencies.environment ?? process.env;
    this.executableExists = dependencies.executableExists ?? defaultExecutableExists;
    this.launchDetached = dependencies.launchDetached ?? launchDetached;
    this.runCommand = dependencies.runCommand ?? runCommand;
    this.sleep = dependencies.sleep ?? defaultSleep;
  }

  listInstalledApps(): InstalledEditorApp[] {
    return editorSpecs.flatMap((spec) => {
      if (!this.resolveExecutablePath(spec)) {
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
        const executablePath = this.requireExecutablePath(spec);
        await this.forceKillProcesses(spec.processNames);
        await this.sleep(220);
        await this.launchDetached(executablePath);
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

  private requireExecutablePath(spec: EditorSpec): string {
    const executablePath = this.resolveExecutablePath(spec);
    if (!executablePath) {
      throw new Error("Installation path was not found");
    }
    return executablePath;
  }

  private resolveExecutablePath(spec: EditorSpec): string | undefined {
    for (const executableName of spec.executableNames) {
      const fromPath = resolveExecutable(executableName, {
        environment: this.environment,
        executableExists: this.executableExists,
        pathDelimiter: ";",
        pathExtensions: [""]
      });
      if (fromPath) {
        return fromPath;
      }
    }

    return this.installCandidatePaths(spec).find(this.executableExists);
  }

  private installCandidatePaths(spec: EditorSpec): string[] {
    const localAppData = localAppDataDirectory(this.environment);
    const programFiles = programFilesDirectories(this.environment);
    const installRoots = uniqueStrings([
      ...(localAppData ? [win32.join(localAppData, "Programs"), localAppData] : []),
      ...programFiles
    ]);

    const candidates: string[] = [];
    for (const root of installRoots) {
      for (const directory of spec.installDirectories) {
        for (const executableName of spec.executableNames) {
          candidates.push(win32.join(root, directory, executableName));
        }
      }
    }
    return uniqueStrings(candidates);
  }

  private async forceKillProcesses(processNames: readonly string[]): Promise<void> {
    await Promise.all(
      processNames.map(async (processName) => {
        try {
          await this.runCommand("taskkill", ["/IM", processName, "/F", "/T"], { timeoutMs: 1_500 });
        } catch {
          // taskkill exits non-zero when the editor is not running; restart can continue.
        }
      })
    );
  }
}

function defaultExecutableExists(path: string): boolean {
  try {
    return statSync(path).isFile();
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
