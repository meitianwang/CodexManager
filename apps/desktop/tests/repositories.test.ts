import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountsStore, StoredAccount } from "../src/shared/models/accounts";
import { accountSummaries } from "../src/shared/domain/accounts-store";
import { accountKeyForStoredAccount } from "../src/shared/domain/account-identity";
import { generateProxyApiKey } from "../src/shared/models/settings";
import type { FileSystemPaths } from "../src/main/repositories/file-system-paths";
import { resolveMacOSFileSystemPaths } from "../src/main/platform/macos/file-system-paths";
import { resolveWindowsFileSystemPaths } from "../src/main/platform/windows/file-system-paths";
import { AccountsStoreRepository } from "../src/main/repositories/accounts-store-repository";
import { SettingsFileRepository } from "../src/main/repositories/settings-repository";
import { AuthFileRepository } from "../src/main/repositories/auth-repository";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Windows file-system paths", () => {
  it("resolves app data and Codex auth locations from injected Windows env", () => {
    const paths = resolveWindowsFileSystemPaths({
      APPDATA: "C:\\Users\\nik\\AppData\\Roaming",
      USERPROFILE: "C:\\Users\\nik"
    });

    expect(paths.applicationSupportDirectory).toBe("C:\\Users\\nik\\AppData\\Roaming\\CodexManager");
    expect(paths.accountStorePath).toBe("C:\\Users\\nik\\AppData\\Roaming\\CodexManager\\accounts.json");
    expect(paths.settingsStorePath).toBe("C:\\Users\\nik\\AppData\\Roaming\\CodexManager\\settings.json");
    expect(paths.codexAuthPath).toBe("C:\\Users\\nik\\.codex\\auth.json");
    expect(paths.codexConfigPath).toBe("C:\\Users\\nik\\.codex\\config.toml");
  });
});

describe("macOS file-system paths", () => {
  it("resolves Application Support and Codex auth locations from Electron paths", () => {
    const paths = resolveMacOSFileSystemPaths(new FakeElectronApp());

    expect(paths.applicationSupportDirectory).toBe("/Users/nik/Library/Application Support/CodexManager");
    expect(paths.accountStorePath).toBe("/Users/nik/Library/Application Support/CodexManager/accounts.json");
    expect(paths.settingsStorePath).toBe("/Users/nik/Library/Application Support/CodexManager/settings.json");
    expect(paths.codexAuthPath).toBe("/Users/nik/.codex/auth.json");
    expect(paths.codexConfigPath).toBe("/Users/nik/.codex/config.toml");
  });
});

describe("settings persistence", () => {
  it("loads defaults from a legacy accounts store and migrates settings out", async () => {
    const paths = await makeTempPaths();
    await writeFile(
      paths.accountStorePath,
      JSON.stringify({
        version: 1,
        accounts: [],
        settings: {
          locale: "zh-TW",
          proxyPort: 19000,
          restartEditorTargets: ["vscode", "cursor"]
        }
      })
    );

    const repository = new SettingsFileRepository(paths);
    const settings = await repository.loadSettings();
    const migratedSettings = JSON.parse(await readFile(paths.settingsStorePath, "utf8")) as Record<string, unknown>;
    const migratedAccounts = JSON.parse(await readFile(paths.accountStorePath, "utf8")) as Record<string, unknown>;

    expect(settings.locale).toBe("zh-Hant");
    expect(settings.launchCodexAfterSwitch).toBe(true);
    expect(settings.proxyPort).toBe(19000);
    expect(settings.restartEditorTargets).toEqual(["vscode", "cursor"]);
    expect(migratedSettings.locale).toBe("zh-Hant");
    expect(migratedAccounts.settings).toBeUndefined();
  });
});

describe("accounts persistence", () => {
  it("saves and reloads accounts with current account projection", async () => {
    const paths = await makeTempPaths();
    const account = makeStoredAccount({
      id: "account-1",
      accountId: "acct-team",
      email: "USER@example.com",
      principalId: "principal-1",
      teamAlias: "Core"
    });
    const store: AccountsStore = {
      version: 1,
      accounts: [account],
      currentSelection: {
        accountId: "acct-team",
        selectedAt: 1_780_000_000,
        sourceDeviceID: "device-a",
        accountKey: accountKeyForStoredAccount(account)
      }
    };

    const repository = new AccountsStoreRepository(paths);
    await repository.saveStore(store);

    const reloaded = await repository.loadStore();
    const summaries = accountSummaries(reloaded);

    expect(reloaded).toEqual(store);
    expect(summaries[0]?.isCurrent).toBe(true);
    expect(summaries[0]?.normalizedPlanLabel).toBe("TEAM");
    expect(summaries[0]?.displayTeamName).toBe("Core");
  });

  it("backs up corrupt accounts before resetting the store", async () => {
    const paths = await makeTempPaths();
    await writeFile(paths.accountStorePath, "{not-json");

    const repository = new AccountsStoreRepository(paths, {
      unixSecondsNow: () => 1_780_145_927
    });
    const store = await repository.loadStore();
    const backup = await readFile(join(paths.applicationSupportDirectory, "accounts.corrupt-1780145927.json"), "utf8");
    const resetStore = JSON.parse(await readFile(paths.accountStorePath, "utf8")) as AccountsStore;

    expect(store).toEqual({ version: 1, accounts: [] });
    expect(backup).toBe("{not-json");
    expect(resetStore).toEqual({ version: 1, accounts: [] });
  });
});

describe("auth persistence", () => {
  it("normalizes and writes Codex auth JSON", async () => {
    const paths = await makeTempPaths();
    const repository = new AuthFileRepository(paths, {
      now: () => new Date("2026-05-30T00:00:00.000Z")
    });

    await repository.writeCurrentAuth({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: makeJwt({
        email: "user@example.com",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct-1",
          chatgpt_plan_type: "plus"
        }
      })
    });

    const written = JSON.parse(await readFile(paths.codexAuthPath, "utf8")) as Record<string, unknown>;
    const tokens = written.tokens as Record<string, unknown>;

    expect(written.auth_mode).toBe("chatgpt");
    expect(written.last_refresh).toBe("2026-05-30T00:00:00.000Z");
    expect(written.access_token).toBeUndefined();
    expect(tokens.access_token).toBe("access-token");
    expect(tokens.refresh_token).toBe("refresh-token");
  });

  it("extracts ChatGPT auth metadata from normalized tokens", async () => {
    const paths = await makeTempPaths();
    const repository = new AuthFileRepository(paths);
    const extracted = repository.extractAuth({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "access-token",
        id_token: makeJwt({
          email: "user@example.com",
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acct-1",
            chatgpt_plan_type: "plus",
            chatgpt_team_name: "Platform"
          }
        })
      }
    });

    expect(extracted.accountId).toBe("acct-1");
    expect(extracted.email).toBe("user@example.com");
    expect(extracted.planType).toBe("plus");
    expect(extracted.teamName).toBe("Platform");
    expect(extracted.principalId).toBe("user@example.com");
  });
});

describe("settings helpers", () => {
  it("generates local proxy API keys with the macOS-compatible shape", () => {
    expect(generateProxyApiKey()).toMatch(/^sk-local-[0-9a-f]{48}$/);
  });
});

async function makeTempPaths(): Promise<FileSystemPaths> {
  const root = await mkdtemp(join(tmpdir(), "codex-manager-desktop-"));
  tempRoots.push(root);
  const applicationSupportDirectory = join(root, "AppData", "Roaming", "CodexManager");
  const codexDirectory = join(root, ".codex");
  await mkdir(applicationSupportDirectory, { recursive: true });
  await mkdir(codexDirectory, { recursive: true });
  return {
    applicationSupportDirectory,
    accountStorePath: join(applicationSupportDirectory, "accounts.json"),
    settingsStorePath: join(applicationSupportDirectory, "settings.json"),
    codexAuthPath: join(codexDirectory, "auth.json"),
    codexConfigPath: join(codexDirectory, "config.toml")
  };
}

function makeStoredAccount(overrides: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id: "account",
    label: "Work",
    accountId: "acct",
    planType: "team",
    authJson: {
      auth_mode: "chatgpt",
      tokens: {
        access_token: "access-token",
        id_token: makeJwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acct"
          }
        })
      }
    },
    addedAt: 1,
    updatedAt: 2,
    ...overrides
  };
}

function makeJwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

class FakeElectronApp {
  getPath(name: string): string {
    if (name === "appData") {
      return "/Users/nik/Library/Application Support";
    }
    if (name === "home") {
      return "/Users/nik";
    }
    return `/Users/nik/${name}`;
  }
}
