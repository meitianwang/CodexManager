import { win32 } from "node:path";

export interface FileSystemPaths {
  applicationSupportDirectory: string;
  accountStorePath: string;
  settingsStorePath: string;
  codexAuthPath: string;
  codexConfigPath: string;
}

export interface WindowsPathEnvironment {
  APPDATA?: string;
  LOCALAPPDATA?: string;
  USERPROFILE?: string;
  HOME?: string;
  HOMEDRIVE?: string;
  HOMEPATH?: string;
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
