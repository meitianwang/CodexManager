import { mkdir } from "node:fs/promises";
import type { AppSettings } from "../../shared/models/settings";
import { defaultAppSettings } from "../../shared/models/settings";
import type { AccountsStore } from "../../shared/models/accounts";
import type { FileSystemPaths } from "./file-system-paths";
import { readTextFile, writeFileAtomically } from "./atomic-file-writer";
import { stableStringify } from "./stable-json";
import {
  parseAppSettings,
  parseLegacyAccountsStore,
  serializeAccountsStore,
  serializeAppSettings
} from "./store-parsers";

export class SettingsFileRepository {
  constructor(
    private readonly paths: Pick<FileSystemPaths, "applicationSupportDirectory" | "accountStorePath" | "settingsStorePath">
  ) {}

  async loadSettings(): Promise<AppSettings> {
    try {
      return parseAppSettings(JSON.parse(await readTextFile(this.paths.settingsStorePath)));
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    const legacyStore = await this.loadLegacyStore();
    if (legacyStore) {
      await this.saveSettings(legacyStore.settings);
      await this.saveAccountsStore(legacyStore);
      return legacyStore.settings;
    }

    return defaultAppSettings();
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await mkdir(this.paths.applicationSupportDirectory, { recursive: true });
    await writeFileAtomically(stableStringify(serializeAppSettings(settings)), this.paths.settingsStorePath);
  }

  private async loadLegacyStore(): Promise<(AccountsStore & { settings: AppSettings }) | undefined> {
    let raw: string;
    try {
      raw = await readTextFile(this.paths.accountStorePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }

    try {
      return parseLegacyAccountsStore(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }

  private async saveAccountsStore(store: AccountsStore): Promise<void> {
    await writeFileAtomically(stableStringify(serializeAccountsStore(store)), this.paths.accountStorePath);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
