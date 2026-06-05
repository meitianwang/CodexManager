import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { proxyAvailableModels, proxyEndpoints } from "../src/shared/models/proxy";
import { appLocales, editorAppIds } from "../src/shared/models/settings";

const appRoot = process.cwd();
const platformBoundaryPatterns = [
  ["process.platform", /process\.platform/],
  ["darwin platform literal", /["']darwin["']/],
  ["win32 platform literal", /["']win32["']/],
  ["linux platform literal", /["']linux["']/],
  ["macOS Applications path", /\/Applications/],
  ["Windows AppData path", /AppData/],
  ["Windows LOCALAPPDATA env", /LOCALAPPDATA/],
  ["Windows USERPROFILE env", /USERPROFILE/],
  ["Windows HOMEDRIVE env", /HOMEDRIVE/],
  ["Windows HOMEPATH env", /HOMEPATH/],
  ["Windows executable filename", /[A-Za-z0-9 ._-]+\.(?:exe|cmd|bat)(?=["'`])/],
  ["Windows Update.exe", /Update\.exe/],
  ["Windows taskkill", /taskkill/],
  ["macOS pkill", /pkill/],
  ["macOS pgrep", /pgrep/],
  ["macOS mdfind", /mdfind/],
  ["macOS open command", /\/usr\/bin\/open/],
  ["Electron login item setting", /openAtLogin/],
  ["Electron login item setter", /setLoginItemSettings/],
  ["Electron login item getter", /getLoginItemSettings/],
  ["macOS bundle icon plist key", /CFBundleIconFile/],
  ["Windows setup icon config", /setupIcon/],
  ["Windows icon asset", /icon\.ico/],
  ["macOS icon asset", /icon\.icns/]
] as const;

describe("desktop behavior contract", () => {
  it("exposes the stable proxy model set used by the desktop proxy UI and runtime", () => {
    expect(proxyAvailableModels).toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5-mini",
      "o3",
      "o3-pro",
      "o4-mini",
      "codex-mini-latest"
    ]);
  });

  it("exposes the stable proxy endpoint contract for OpenAI and Anthropic-compatible routes", () => {
    expect(proxyEndpoints).toEqual([
      {
        id: "chatCompletions",
        method: "POST",
        path: "/v1/chat/completions",
        description: "OpenAI Chat Completions"
      },
      {
        id: "responses",
        method: "POST",
        path: "/v1/responses",
        description: "OpenAI Responses"
      },
      {
        id: "messages",
        method: "POST",
        path: "/v1/messages",
        description: "Anthropic Messages"
      }
    ]);
  });

  it("keeps the desktop locale contract stable for persisted settings and renderer messages", () => {
    expect(appLocales).toEqual([
      "en",
      "zh-Hans",
      "zh-Hant",
      "ja",
      "ko",
      "fr",
      "de",
      "it",
      "es",
      "ru",
      "nl"
    ]);
  });

  it("keeps the desktop editor restart target contract stable across platform adapters", () => {
    expect(editorAppIds).toEqual([
      "vscode",
      "vscodeInsiders",
      "cursor",
      "antigravity",
      "kiro",
      "trae",
      "qoder"
    ]);
  });

  it("keeps platform-specific desktop integration strings behind platform adapters", () => {
    const scannedRoots = [resolve(appRoot, "src", "main"), resolve(appRoot, "src", "shared")];
    const offenders = scannedRoots
      .flatMap((root) => listTypeScriptFiles(root))
      .filter((filePath) => !relative(appRoot, filePath).split(sep).includes("platform"))
      .flatMap((filePath) => platformBoundaryTokenHits(filePath));

    expect(offenders).toEqual([]);
  });
});

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const filePath = resolve(directory, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      return listTypeScriptFiles(filePath);
    }
    return filePath.endsWith(".ts") || filePath.endsWith(".tsx") ? [filePath] : [];
  });
}

function platformBoundaryTokenHits(filePath: string): string[] {
  const content = readFileSync(filePath, "utf8");
  return platformBoundaryPatterns.flatMap(([label, pattern]) => {
    if (!pattern.test(content)) {
      return [];
    }
    return [`${relative(appRoot, filePath)} contains ${label}`];
  });
}
