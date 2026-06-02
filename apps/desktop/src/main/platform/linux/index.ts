import type { App } from "electron";
import type { FileSystemPaths } from "../../repositories/file-system-paths";
import type {
  CodexLauncherLike,
  DesktopPlatform,
  EditorAppServiceLike,
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
    }
  };
}

function unsupported(feature: string): never {
  throw new Error(`${unsupportedMessage} Missing ${feature}.`);
}
