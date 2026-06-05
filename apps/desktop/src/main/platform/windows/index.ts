import type { App } from "electron";
import { LaunchAtStartupService } from "../launch-at-startup-service";
import type { DesktopPlatform } from "../types";
import { createElectronTrayAdapter } from "../electron-tray-adapter";
import { CodexCLIService } from "./codex-cli-service";
import { EditorAppService } from "./editor-app-service";
import { resolveWindowsRuntimeFileSystemPaths } from "./file-system-paths";
import { windowsSquirrelLoginItemTarget } from "./launch-at-startup";

export interface WindowsDesktopPlatformOptions {
  environment?: NodeJS.ProcessEnv;
  execPath?: string;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
}

export function createWindowsDesktopPlatform(
  electronApp: App,
  options: WindowsDesktopPlatformOptions = {}
): DesktopPlatform {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const isPackaged = options.isPackaged ?? electronApp.isPackaged;
  const execPath = options.execPath ?? process.execPath;

  return {
    id: "windows",
    lifecycle: {
      quitOnWindowAllClosed: true
    },
    requestHeaders: {
      codexToolsUserAgent: "codex-tools-windows/0.1",
      codexUpstreamUserAgent: "codex_cli_rs/0.116.0 (Windows 11; x64) CodexManager/0.1"
    },
    smokeDefaults: {
      workspacePath: "C:\\smoke-workspace"
    },
    sourceDeviceID: "windows-local",
    windowOptions: {
      iconAssetName: "icon.ico"
    },
    paths() {
      return resolveWindowsRuntimeFileSystemPaths(electronApp, environment, platform);
    },
    launchAtStartupService() {
      return new LaunchAtStartupService(electronApp, {
        loginItemTarget: windowsSquirrelLoginItemTarget({ execPath, isPackaged, platform })
      });
    },
    codexLauncher() {
      return new CodexCLIService({ environment });
    },
    createTrayAdapter() {
      return createElectronTrayAdapter();
    },
    editorApps() {
      return new EditorAppService({ environment });
    },
    guiEnvironment() {
      return {
        async setEnvironmentVariable(name: string, _value: string): Promise<{ warning: string }> {
          return {
            warning: `${name} was not persisted for Windows GUI applications. Restart Codex from a shell that exports the variable or configure Windows environment variables manually.`
          };
        }
      };
    }
  };
}
