import type { InstalledEditorApp } from "../../shared/models/app";
import type { EditorAppID } from "../../shared/models/settings";
import type { FileSystemPaths } from "../repositories/file-system-paths";
import type { TrayAdapter } from "./tray-service";

export type DesktopPlatformID = "windows" | "macos" | "linux";

export interface CodexLauncherLike {
  launchApp(workspacePath?: string): Promise<boolean>;
}

export interface EditorAppServiceLike {
  listInstalledApps(): InstalledEditorApp[];
  restartSelectedApps(
    targets: readonly EditorAppID[]
  ): Promise<{ restarted: EditorAppID[]; error?: string }> | { restarted: EditorAppID[]; error?: string };
}

export interface LaunchAtStartupServiceLike {
  setEnabled(enabled: boolean): void;
  syncWithStoreValue(enabled: boolean): void;
}

export interface DesktopPlatformRequestHeaders {
  readonly codexToolsUserAgent: string;
  readonly codexUpstreamUserAgent: string;
}

export interface DesktopPlatformLifecycle {
  readonly quitOnWindowAllClosed: boolean;
}

export interface DesktopPlatformSmokeDefaults {
  readonly workspacePath: string;
}

export interface DesktopPlatformWindowOptions {
  readonly iconAssetName?: string;
}

export interface DesktopPlatform {
  readonly id: DesktopPlatformID;
  readonly lifecycle: DesktopPlatformLifecycle;
  readonly requestHeaders: DesktopPlatformRequestHeaders;
  readonly smokeDefaults: DesktopPlatformSmokeDefaults;
  readonly sourceDeviceID: string;
  readonly windowOptions: DesktopPlatformWindowOptions;
  codexLauncher(): CodexLauncherLike;
  createTrayAdapter(): TrayAdapter;
  editorApps(): EditorAppServiceLike;
  launchAtStartupService(): LaunchAtStartupServiceLike;
  paths(): FileSystemPaths;
}
