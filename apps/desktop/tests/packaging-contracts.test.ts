import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = process.cwd();
const require = createRequire(import.meta.url);

type ForgeMaker = {
  configOrConfigFetcher?: { setupIcon?: string };
  defaultPlatforms?: string[];
  name: string;
  platformsToMakeOn?: string[];
};

type ForgeConfig = {
  makers?: ForgeMaker[];
  packagerConfig?: { icon?: string };
};

function readAppFile(relativePath: string): Buffer {
  return readFileSync(resolve(appRoot, relativePath));
}

function readForgeConfig(): ForgeConfig {
  return require(resolve(appRoot, "forge.config.cjs")) as ForgeConfig;
}

function findMaker(forgeConfig: ForgeConfig, makerName: string): ForgeMaker | undefined {
  return forgeConfig.makers?.find((maker) => maker.name === makerName);
}

function platformsForMaker(forgeConfig: ForgeConfig, makerName: string): readonly string[] {
  const maker = findMaker(forgeConfig, makerName);
  return maker?.platformsToMakeOn ?? maker?.defaultPlatforms ?? [];
}

describe("desktop packaging contracts", () => {
  it("keeps the Electron app rooted at apps/desktop instead of the old Windows-port path", () => {
    const repoRoot = resolve(appRoot, "..", "..");
    const packageJson = JSON.parse(readAppFile("package.json").toString("utf8")) as {
      name: string;
      description: string;
    };

    expect(existsSync(resolve(repoRoot, "apps", "desktop", "package.json"))).toBe(true);
    expect(existsSync(resolve(repoRoot, "apps", "windows"))).toBe(false);
    expect(packageJson.name).toBe("codex-manager-desktop");
    expect(packageJson.description).toContain("Desktop app");
    expect(packageJson.description).not.toContain("Windows");
  });

  it("keeps package icon assets available for Windows and macOS", () => {
    const svg = readAppFile("assets/icon.svg").toString("utf8");
    const ico = readAppFile("assets/icon.ico");
    const icns = readAppFile("assets/icon.icns");

    expect(svg).toContain("<svg");
    expect(svg).toContain("CodexManager");
    expect(Array.from(ico.subarray(0, 4))).toEqual([0x00, 0x00, 0x01, 0x00]);
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(statSync(resolve(appRoot, "assets/icon.icns")).size).toBeGreaterThan(1024);
  });

  it("verifies desktop package assets before package and make commands", () => {
    const packageJson = JSON.parse(readAppFile("package.json").toString("utf8")) as {
      scripts: Record<string, string>;
    };
    const windowsPackageScript = readFileSync(resolve(appRoot, "..", "..", "scripts", "package_windows.ps1"), "utf8");
    const releaseDoc = readFileSync(resolve(appRoot, "..", "..", "docs", "release-windows.md"), "utf8");

    expect(packageJson.scripts["verify:package-assets"]).toBe("node scripts/verify-package-assets.mjs");
    expect(packageJson.scripts.package).toContain("pnpm run verify:package-assets");
    expect(packageJson.scripts.make).toContain("pnpm run verify:package-assets");
    expect(packageJson.scripts["package:macos"]).toContain("pnpm run verify:package-assets");
    expect(windowsPackageScript).toContain("pnpm run verify:package-assets");
    expect(windowsPackageScript).toContain('$DesktopApp = Join-Path $RepoRoot "apps/desktop"');
    expect(windowsPackageScript).toContain("Push-Location $DesktopApp");
    expect(windowsPackageScript).toContain("pnpm exec electron-forge package --platform win32 --arch $Arch");
    expect(windowsPackageScript).toContain(
      "pnpm exec electron-forge make --skip-package --targets squirrel --platform win32 --arch $Arch"
    );
    expect(windowsPackageScript).toContain('Join-Path $DesktopApp "out/CodexManager-win32-$Arch"');
    expect(windowsPackageScript).toContain('Join-Path $DesktopApp "out/make"');
    expect(windowsPackageScript).not.toContain("pnpm run package");
    expect(windowsPackageScript).not.toContain("apps/windows");
    expect(releaseDoc).toContain(".\\scripts\\package_windows.ps1 -Target package -Arch x64");
    expect(releaseDoc).toContain("package --platform win32 --arch x64");
    expect(releaseDoc).toContain("apps/desktop/out/CodexManager-win32-x64");
  });

  it("keeps Electron Forge pointed at platform-specific package icons", () => {
    const forgeConfig = readForgeConfig();
    const squirrel = findMaker(forgeConfig, "squirrel");

    expect(forgeConfig.packagerConfig?.icon).toBe(resolve(appRoot, "assets", "icon"));
    expect(squirrel?.configOrConfigFetcher?.setupIcon).toBe(resolve(appRoot, "assets", "icon.ico"));
    expect(platformsForMaker(forgeConfig, "squirrel")).toEqual(["win32"]);
  });

  it("does not expose Linux as an Electron release package target yet", () => {
    const forgeConfig = readForgeConfig();
    const releaseDoc = readFileSync(resolve(appRoot, "..", "..", "docs", "release-desktop.md"), "utf8");
    const verifier = readAppFile("scripts/verify-package-assets.mjs").toString("utf8");
    const zipPlatforms = platformsForMaker(forgeConfig, "zip");

    expect(zipPlatforms).toEqual(["darwin"]);
    expect(zipPlatforms).not.toContain("linux");
    expect(verifier).toContain('platformsForMaker(forgeConfig, "squirrel")');
    expect(verifier).toContain("Squirrel packaging must target Windows only");
    expect(verifier).toContain('platformsForMaker(forgeConfig, "zip")');
    expect(verifier).toContain("must not expose Linux ZIP packaging while Linux is unsupported");
    expect(releaseDoc).toContain("Linux hardening remains deferred");
    expect(releaseDoc).toContain("Linux explicit as unsupported");
  });

  it("keeps macOS package smoke wired into CI", () => {
    const workflow = readFileSync(resolve(appRoot, "..", "..", ".github", "workflows", "macos-desktop.yml"), "utf8");
    const releaseDoc = readFileSync(resolve(appRoot, "..", "..", "docs", "release-desktop.md"), "utf8");

    expect(workflow).toContain("runs-on: macos-latest");
    expect(workflow).toContain("pnpm run verify:package-assets");
    expect(workflow).toContain("pnpm run typecheck");
    expect(workflow).toContain("pnpm test");
    expect(workflow).toContain("swift test");
    expect(workflow).toContain("pnpm run smoke:macos-package");
    expect(workflow).toContain("CFBundleIconFile");
    expect(workflow).toContain("CodexManager-macOS-Smoke");
    expect(workflow).toContain("CodexManager-macOS-App");
    expect(releaseDoc).toContain(".github/workflows/macos-desktop.yml");
    expect(releaseDoc).toContain("CodexManager-macOS-Smoke");
  });

  it("keeps macOS CI named as a desktop release workflow", () => {
    const repoRoot = resolve(appRoot, "..", "..");
    const workflowPath = resolve(repoRoot, ".github", "workflows", "macos-desktop.yml");
    const workflow = readFileSync(workflowPath, "utf8");
    const releaseDoc = readFileSync(resolve(repoRoot, "docs", "release-desktop.md"), "utf8");

    expect(existsSync(workflowPath)).toBe(true);
    expect(workflow).toContain("name: macOS Desktop");
    expect(workflow).toContain(".github/workflows/macos-desktop.yml");
    expect(workflow).toContain("apps/desktop/**");
    expect(workflow).toContain("Install desktop app dependencies");
    expect(workflow).toContain("Smoke test packaged macOS desktop app");
    expect(releaseDoc).toContain(".github/workflows/macos-desktop.yml");
  });

  it("keeps Windows CI named as a desktop release workflow", () => {
    const repoRoot = resolve(appRoot, "..", "..");
    const workflowPath = resolve(repoRoot, ".github", "workflows", "windows-desktop.yml");
    const oldWorkflowPath = resolve(repoRoot, ".github", "workflows", "windows-app.yml");
    const workflow = readFileSync(workflowPath, "utf8");
    const releaseDoc = readFileSync(resolve(repoRoot, "docs", "release-windows.md"), "utf8");

    expect(existsSync(workflowPath)).toBe(true);
    expect(existsSync(oldWorkflowPath)).toBe(false);
    expect(workflow).toContain("name: Windows Desktop");
    expect(workflow).toContain(".github/workflows/windows-desktop.yml");
    expect(workflow).toContain("apps/desktop/**");
    expect(workflow).toContain("Install desktop app dependencies");
    expect(workflow).not.toContain(".github/workflows/windows-app.yml");
    expect(workflow).not.toContain("Windows App");
    expect(releaseDoc).toContain(".github/workflows/windows-desktop.yml");
    expect(releaseDoc).not.toContain(".github/workflows/windows-app.yml");
  });

  it("keeps packaged macOS smoke artifacts independently validated by the wrapper", () => {
    const packageSmokeScript = readAppFile("scripts/smoke-macos-package.mjs").toString("utf8");

    expect(packageSmokeScript).toContain("validateSmokeResult(smokeResult)");
    expect(packageSmokeScript).toContain("validationErrors.length === 0");
    expect(packageSmokeScript).toContain("account export package did not include the five smoke accounts");
    expect(packageSmokeScript).toContain("proxy route ${key} did not return a successful status");
    expect(packageSmokeScript).toContain("UI snapshot evidence did not include Accounts, Proxy, and Settings");
    expect(packageSmokeScript).toContain("launch-at-startup recorder evidence did not include enable then disable");
  });

  it("keeps Windows runner smoke deferred for the macOS-machine migration phase", () => {
    const audit = readFileSync(resolve(appRoot, "..", "..", "docs", "desktop-migration-acceptance-audit.md"), "utf8");
    const migrationDesign = readFileSync(
      resolve(appRoot, "..", "..", "docs", "superpowers", "specs", "2026-06-01-desktop-mainline-migration-design.md"),
      "utf8"
    );

    expect(audit).toContain(
      "The user has clarified that Windows runner evidence is not important for the current macOS-machine phase."
    );
    expect(audit).toContain("Real packaged Windows smoke is deferred to a later Windows release pass");
    expect(migrationDesign).toContain(
      "Windows packaged smoke on a Windows runner before a later Windows release pass; this is deferred for the current macOS-machine Goal phase."
    );
    expect(migrationDesign).toContain(
      "installed Windows smoke remains a later Windows release gate"
    );
  });

  it("keeps macOS CI evidence collection read-only", () => {
    const packageJson = JSON.parse(readAppFile("package.json").toString("utf8")) as {
      scripts: Record<string, string>;
    };
    const output = execFileSync(process.execPath, ["scripts/collect-macos-ci-evidence.mjs", "--json", "--offline"], {
      cwd: appRoot,
      encoding: "utf8"
    });
    const report = JSON.parse(output) as {
      mode: string;
      sideEffects: Record<string, boolean>;
      status: string;
    };
    const collector = readAppFile("scripts/collect-macos-ci-evidence.mjs").toString("utf8");

    expect(packageJson.scripts["collect:macos-ci-evidence"]).toBe(
      "node scripts/collect-macos-ci-evidence.mjs"
    );
    expect(["pending", "passed"]).toContain(report.status);
    expect(report.mode).toBe("read-only-ci-evidence");
    expect(report.sideEffects).toEqual({
      mutatesRemote: false,
      dispatchesWorkflow: false,
      downloadsArtifacts: false
    });
    expect(collector).toContain("gh");
    expect(collector).toContain("run");
    expect(collector).toContain("list");
    expect(collector).not.toContain("workflow\", \"run");
    expect(collector).not.toContain("run\", \"download");
    expect(collector.indexOf('child.on("close"')).toBeLessThan(collector.indexOf('child.stdout.on("data"'));
  });

  it("keeps real macOS side-effect verification approval-gated and dry-run by default", () => {
    const packageJson = JSON.parse(readAppFile("package.json").toString("utf8")) as {
      scripts: Record<string, string>;
    };
    const output = execFileSync(process.execPath, ["scripts/plan-macos-real-side-effects.mjs", "--json"], {
      cwd: appRoot,
      encoding: "utf8"
    });
    const report = JSON.parse(output) as {
      executionMode: string;
      approvalGate: { required: boolean; env: string };
      plannedChecks: Array<{ id: string; approvalRequired: boolean }>;
      sideEffects: Record<string, boolean>;
    };

    expect(packageJson.scripts["plan:macos-real-side-effects"]).toBe(
      "node scripts/plan-macos-real-side-effects.mjs"
    );
    expect(report.executionMode).toBe("dry-run-plan");
    expect(report.approvalGate).toMatchObject({
      required: true,
      env: "CODEX_MANAGER_ALLOW_REAL_MACOS_SIDE_EFFECTS"
    });
    expect(report.plannedChecks.map((check) => check.id)).toEqual([
      "oauth-browser-login",
      "codex-launch",
      "editor-restart",
      "login-item",
      "settings-write"
    ]);
    expect(report.plannedChecks.every((check) => check.approvalRequired)).toBe(true);
    expect(report.sideEffects).toEqual({
      writes: false,
      codexLaunched: false,
      editorsRestarted: false,
      loginItemsChanged: false,
      oauthStarted: false
    });
  });

  it("keeps executable macOS side-effect verification behind explicit checks and approval", () => {
    const packageJson = JSON.parse(readAppFile("package.json").toString("utf8")) as {
      scripts: Record<string, string>;
    };
    const output = execFileSync(process.execPath, ["scripts/verify-macos-real-side-effects.mjs", "--json"], {
      cwd: appRoot,
      encoding: "utf8"
    });
    const report = JSON.parse(output) as {
      approvalGate: { required: boolean; env: string };
      executionMode: string;
      sideEffects: Record<string, boolean>;
      status: string;
    };
    const verifier = readAppFile("scripts/verify-macos-real-side-effects.mjs").toString("utf8");

    expect(packageJson.scripts["verify:macos-real-side-effects"]).toBe(
      "pnpm run build:main && node scripts/verify-macos-real-side-effects.mjs"
    );
    expect(report.status).toBe("approval-required");
    expect(report.executionMode).toBe("dry-run-verifier");
    expect(report.approvalGate).toMatchObject({
      required: true,
      env: "CODEX_MANAGER_ALLOW_REAL_MACOS_SIDE_EFFECTS"
    });
    expect(report.sideEffects).toEqual({
      writes: false,
      codexLaunched: false,
      editorsRestarted: false,
      loginItemsChanged: false,
      oauthStarted: false
    });
    expect(verifier).toContain("--execute");
    expect(verifier).toContain("--check");
    expect(verifier).toContain("runSettingsWriteCheck");
    expect(verifier).toContain("runOAuthBrowserLoginCheck");
    expect(verifier).toContain("runCodexLaunchCheck");
    expect(verifier).toContain("runEditorRestartCheck");
    expect(verifier).toContain("runLoginItemCheck");
    expect(verifier).toContain("CODEX_MANAGER_ALLOW_REAL_MACOS_SIDE_EFFECTS");
    expect(verifier).toContain("createSettingsBackup(settingsPath, originalBytes)");
    expect(verifier).toContain("settingsBackupPath");
    expect(verifier).toContain("codexmanager-settings-backup.");
    expect(verifier).toContain("createAccountStoreBackup(paths.accountStorePath, accountStoreOriginal)");
    expect(verifier).toContain("accountStoreBackupPath");
    expect(verifier).toContain("codexmanager-oauth-account-store-backup.");
    expect(verifier).toContain("Account store file was not restored to its original bytes");
    expect(verifier).toContain('child.kill("SIGTERM")');
    expect(verifier).toContain('child.kill("SIGKILL")');
    expect(verifier.indexOf('child.on("close"')).toBeLessThan(verifier.indexOf('child.stdout.on("data"'));
  });

  it("keeps isolated macOS real-data workflow verification confined to temp data", () => {
    const packageJson = JSON.parse(readAppFile("package.json").toString("utf8")) as {
      scripts: Record<string, string>;
    };
    const verifier = readAppFile("scripts/verify-macos-isolated-real-data.mjs").toString("utf8");

    expect(packageJson.scripts["verify:macos-isolated-real-data"]).toBe(
      "pnpm run build:main && node scripts/verify-macos-isolated-real-data.mjs"
    );
    expect(verifier).toContain("mode: \"isolated-real-data-copy\"");
    expect(verifier).toContain("sourceDeviceID: \"macos-isolated\"");
    expect(verifier).toContain("realUserDataWrites: false");
    expect(verifier).toContain("isolatedTempWrites: true");
    expect(verifier).toContain("codexLaunched: false");
    expect(verifier).toContain("editorsRestarted: false");
    expect(verifier).toContain("loginItemsChanged: false");
    expect(verifier).toContain("oauthStarted: false");
    expect(verifier).toContain("await rm(tempRoot, { force: true, recursive: true })");
  });
});
