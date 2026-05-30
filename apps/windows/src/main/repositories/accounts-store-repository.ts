import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AccountsStore } from "../../shared/models/accounts";
import { emptyAccountsStore } from "../../shared/models/accounts";
import type { FileSystemPaths } from "./file-system-paths";
import { readTextFile, setPrivatePermissions, writeFileAtomically } from "./atomic-file-writer";
import { stableStringify } from "./stable-json";
import { parseAccountsStore, serializeAccountsStore } from "./store-parsers";

export interface AccountsStoreRepositoryOptions {
  unixSecondsNow?: () => number;
}

export class AccountsStoreRepository {
  private readonly unixSecondsNow: () => number;

  constructor(
    private readonly paths: Pick<FileSystemPaths, "applicationSupportDirectory" | "accountStorePath">,
    options: AccountsStoreRepositoryOptions = {}
  ) {
    this.unixSecondsNow = options.unixSecondsNow ?? (() => Math.floor(Date.now() / 1000));
  }

  async loadStore(): Promise<AccountsStore> {
    let raw: string;
    try {
      raw = await readTextFile(this.paths.accountStorePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return emptyAccountsStore();
      }
      throw error;
    }

    try {
      return parseAccountsStore(JSON.parse(raw));
    } catch {
      await this.backupCorruptedStore(raw);
      const emptyStore = emptyAccountsStore();
      await this.saveStore(emptyStore);
      return emptyStore;
    }
  }

  async saveStore(store: AccountsStore): Promise<void> {
    await mkdir(this.paths.applicationSupportDirectory, { recursive: true });
    await writeFileAtomically(stableStringify(serializeAccountsStore(store)), this.paths.accountStorePath);
  }

  private async backupCorruptedStore(raw: string): Promise<void> {
    await mkdir(this.paths.applicationSupportDirectory, { recursive: true });
    const backupPath = join(this.paths.applicationSupportDirectory, `accounts.corrupt-${this.unixSecondsNow()}.json`);
    await writeFileAtomically(raw, backupPath);
    await setPrivatePermissions(backupPath);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
