import { win32 } from "node:path";
import type { LoginItemSettingsOptions } from "../launch-at-startup-service";

export interface WindowsLoginItemTargetOptions {
  execPath?: string;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
}

export function windowsSquirrelLoginItemTarget(
  options: WindowsLoginItemTargetOptions = {}
): LoginItemSettingsOptions | undefined {
  const platform = options.platform ?? process.platform;
  const isPackaged = options.isPackaged ?? false;
  if (platform !== "win32" || !isPackaged) {
    return undefined;
  }

  const execPath = options.execPath ?? process.execPath;
  const appDirectory = win32.dirname(execPath);
  if (!/^app-[^\\/]+$/i.test(win32.basename(appDirectory))) {
    return undefined;
  }

  return {
    path: win32.join(win32.dirname(appDirectory), "Update.exe"),
    args: ["--processStart", win32.basename(execPath)]
  };
}
