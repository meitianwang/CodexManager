import { posix } from "node:path";
import type { App } from "electron";
import type { FileSystemPaths } from "../../repositories/file-system-paths";

export interface MacOSPathEnvironment {
  CODEX_MANAGER_ELECTRON_SMOKE_ROOT?: string;
}

export function resolveMacOSFileSystemPaths(
  electronApp: Pick<App, "getPath">,
  env: MacOSPathEnvironment = process.env
): FileSystemPaths {
  const smokeRoot = env.CODEX_MANAGER_ELECTRON_SMOKE_ROOT;
  if (smokeRoot) {
    const applicationSupportDirectory = posix.join(smokeRoot, "app-data", "CodexManager");
    const codexDirectory = posix.join(smokeRoot, "user", ".codex");
    return {
      applicationSupportDirectory,
      accountStorePath: posix.join(applicationSupportDirectory, "accounts.json"),
      settingsStorePath: posix.join(applicationSupportDirectory, "settings.json"),
      codexAuthPath: posix.join(codexDirectory, "auth.json"),
      codexConfigPath: posix.join(codexDirectory, "config.toml")
    };
  }

  const applicationSupportDirectory = posix.join(electronApp.getPath("appData"), "CodexManager");
  const codexDirectory = posix.join(electronApp.getPath("home"), ".codex");
  return {
    applicationSupportDirectory,
    accountStorePath: posix.join(applicationSupportDirectory, "accounts.json"),
    settingsStorePath: posix.join(applicationSupportDirectory, "settings.json"),
    codexAuthPath: posix.join(codexDirectory, "auth.json"),
    codexConfigPath: posix.join(codexDirectory, "config.toml")
  };
}
