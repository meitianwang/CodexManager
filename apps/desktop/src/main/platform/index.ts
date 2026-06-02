import type { App } from "electron";
import type { DesktopPlatform } from "./types";
import { createLinuxDesktopPlatform } from "./linux";
import { createMacOSDesktopPlatform } from "./macos";
import { createWindowsDesktopPlatform } from "./windows";

export function createDesktopPlatform(electronApp: App, platform: NodeJS.Platform = process.platform): DesktopPlatform {
  if (platform === "darwin") {
    return createMacOSDesktopPlatform(electronApp);
  }
  if (platform === "win32") {
    return createWindowsDesktopPlatform(electronApp, { platform });
  }
  if (platform === "linux") {
    return createLinuxDesktopPlatform(electronApp);
  }
  throw new Error(`Unsupported desktop platform: ${platform}`);
}
