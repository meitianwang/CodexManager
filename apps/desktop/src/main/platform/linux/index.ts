import type { App } from "electron";
import type { FileSystemPaths } from "../../repositories/file-system-paths";
import type {
  CodexLauncherLike,
  DesktopPlatform,
  EditorAppServiceLike,
  GUIEnvironmentServiceLike,
  LaunchAtStartupServiceLike
} from "../types";
import type { TrayAdapter } from "../tray-service";

const unsupportedMessage =
  "Linux desktop platform is not supported yet. Keep this explicit until a Linux release pass is requested.";

export function createLinuxDesktopPlatform(_electronApp: App): DesktopPlatform {
  return {
    id: "linux",
    lifecycle: {
      quitOnWindowAllClosed: true
    },
    requestHeaders: {
      codexToolsUserAgent: "codex-tools-linux/0.1",
      codexUpstreamUserAgent: `codex_cli_rs/0.116.0 (Linux; ${process.arch}) CodexManager/0.1`
    },
    smokeDefaults: {
      workspacePath: "/tmp/smoke-workspace"
    },
    sourceDeviceID: "linux-unsupported",
    windowOptions: {},
    paths(): FileSystemPaths {
      return unsupported("filesystem paths");
    },
    launchAtStartupService(): LaunchAtStartupServiceLike {
      return {
        setEnabled(): void {
          unsupported("launch at startup");
        },
        syncWithStoreValue(): void {
          unsupported("launch at startup");
        }
      };
    },
    codexLauncher(): CodexLauncherLike {
      return {
        async launchApp(): Promise<boolean> {
          return unsupported("Codex launch");
        },
        async restartApp(): Promise<boolean> {
          return unsupported("Codex restart");
        }
      };
    },
    createTrayAdapter(): TrayAdapter {
      return unsupported("tray integration");
    },
    editorApps(): EditorAppServiceLike {
      return {
        listInstalledApps() {
          return unsupported("editor detection");
        },
        restartSelectedApps() {
          return unsupported("editor restart");
        }
      };
    },
    guiEnvironment(): GUIEnvironmentServiceLike {
      return {
        async setEnvironmentVariable(name: string, _value: string): Promise<{ warning: string }> {
          return {
            warning: `${name} was not persisted for Linux GUI applications. Start Codex from an environment that exports the variable.`
          };
        },
        async unsetEnvironmentVariable(): Promise<{ warning?: string }> {
          return {};
        }
      };
    }
  };
}

function unsupported(feature: string): never {
  throw new Error(`${unsupportedMessage} Missing ${feature}.`);
}
