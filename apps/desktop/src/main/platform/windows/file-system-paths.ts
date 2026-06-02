import { join } from "node:path";
import { win32 } from "node:path";
import type { App } from "electron";
import type { FileSystemPaths } from "../../repositories/file-system-paths";

export interface WindowsPathEnvironment {
  APPDATA?: string;
  LOCALAPPDATA?: string;
  USERPROFILE?: string;
  HOME?: string;
  HOMEDRIVE?: string;
  HOMEPATH?: string;
  CODEX_MANAGER_ELECTRON_SMOKE_ROOT?: string;
}

export function resolveWindowsRuntimeFileSystemPaths(
  electronApp: Pick<App, "getPath">,
  env: WindowsPathEnvironment = process.env,
  platform: NodeJS.Platform = process.platform
): FileSystemPaths {
  const smokeRoot = env.CODEX_MANAGER_ELECTRON_SMOKE_ROOT;
  if (smokeRoot) {
    return resolveSmokeFileSystemPaths(smokeRoot);
  }

  if (platform === "win32") {
    return resolveWindowsFileSystemPaths(env);
  }

  const applicationSupportDirectory = electronApp.getPath("userData");
  const codexDirectory = join(electronApp.getPath("home"), ".codex");
  return {
    applicationSupportDirectory,
    accountStorePath: join(applicationSupportDirectory, "accounts.json"),
    settingsStorePath: join(applicationSupportDirectory, "settings.json"),
    codexAuthPath: join(codexDirectory, "auth.json"),
    codexConfigPath: join(codexDirectory, "config.toml")
  };
}

export function resolveWindowsFileSystemPaths(env: WindowsPathEnvironment = process.env): FileSystemPaths {
  const appDataDirectory = resolveAppDataDirectory(env);
  const userProfileDirectory = resolveUserProfileDirectory(env);
  const applicationSupportDirectory = win32.join(appDataDirectory, "CodexManager");
  const codexDirectory = win32.join(userProfileDirectory, ".codex");

  return {
    applicationSupportDirectory,
    accountStorePath: win32.join(applicationSupportDirectory, "accounts.json"),
    settingsStorePath: win32.join(applicationSupportDirectory, "settings.json"),
    codexAuthPath: win32.join(codexDirectory, "auth.json"),
    codexConfigPath: win32.join(codexDirectory, "config.toml")
  };
}

function resolveSmokeFileSystemPaths(smokeRoot: string): FileSystemPaths {
  const applicationSupportDirectory = join(smokeRoot, "app-data", "CodexManager");
  const codexDirectory = join(smokeRoot, "user", ".codex");
  return {
    applicationSupportDirectory,
    accountStorePath: join(applicationSupportDirectory, "accounts.json"),
    settingsStorePath: join(applicationSupportDirectory, "settings.json"),
    codexAuthPath: join(codexDirectory, "auth.json"),
    codexConfigPath: join(codexDirectory, "config.toml")
  };
}

function resolveAppDataDirectory(env: WindowsPathEnvironment): string {
  if (env.APPDATA) {
    return env.APPDATA;
  }
  if (env.USERPROFILE) {
    return win32.join(env.USERPROFILE, "AppData", "Roaming");
  }
  if (env.LOCALAPPDATA) {
    return win32.join(env.LOCALAPPDATA, "..", "Roaming");
  }
  return win32.join(resolveUserProfileDirectory(env), "AppData", "Roaming");
}

function resolveUserProfileDirectory(env: WindowsPathEnvironment): string {
  if (env.USERPROFILE) {
    return env.USERPROFILE;
  }
  if (env.HOMEDRIVE && env.HOMEPATH) {
    return `${env.HOMEDRIVE}${env.HOMEPATH}`;
  }
  if (env.HOME) {
    return env.HOME;
  }
  throw new Error("Cannot resolve Windows user profile directory");
}
