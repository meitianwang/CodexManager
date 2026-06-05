import type { App } from "electron";
import { createElectronTrayAdapter } from "../electron-tray-adapter";
import { LaunchAtStartupService } from "../launch-at-startup-service";
import type { DesktopPlatform } from "../types";
import { MacOSCodexCLIService } from "./codex-cli-service";
import { MacOSEditorAppService } from "./editor-app-service";
import { resolveMacOSFileSystemPaths, type MacOSPathEnvironment } from "./file-system-paths";
import { MacOSGUIEnvironmentService } from "./gui-environment-service";

export interface MacOSDesktopPlatformOptions {
  environment?: NodeJS.ProcessEnv & MacOSPathEnvironment;
}

export function createMacOSDesktopPlatform(electronApp: App, options: MacOSDesktopPlatformOptions = {}): DesktopPlatform {
  const environment = options.environment ?? process.env;

  return {
    id: "macos",
    lifecycle: {
      quitOnWindowAllClosed: false
    },
    requestHeaders: {
      codexToolsUserAgent: "codex-tools-macos/0.1",
      codexUpstreamUserAgent: `codex_cli_rs/0.116.0 (macOS; ${process.arch}) CodexManager/0.1`
    },
    smokeDefaults: {
      workspacePath: "/tmp/smoke-workspace"
    },
    sourceDeviceID: "macos-local",
    windowOptions: {},
    paths() {
      return resolveMacOSFileSystemPaths(electronApp, environment);
    },
    launchAtStartupService() {
      return new LaunchAtStartupService(electronApp);
    },
    codexLauncher() {
      return new MacOSCodexCLIService({ environment });
    },
    createTrayAdapter() {
      return createElectronTrayAdapter();
    },
    editorApps() {
      return new MacOSEditorAppService({ environment });
    },
    guiEnvironment() {
      return new MacOSGUIEnvironmentService();
    }
  };
}
