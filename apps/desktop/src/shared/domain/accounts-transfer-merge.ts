import type { AccountsImportResult } from "../models/account-transfer";
import type { AccountsStore, StoredAccount } from "../models/accounts";
import { storedAccountsMatch } from "./account-identity";

export interface AccountsTransferMergeResult {
  store: AccountsStore;
  result: AccountsImportResult;
}

export interface AccountsTransferMergeOptions {
  idGenerator?: () => string;
}

export function applyAccountsTransferMerge(
  importedAccounts: readonly StoredAccount[],
  selectedAccountIds: ReadonlySet<string>,
  store: AccountsStore,
  now: number,
  options: AccountsTransferMergeOptions = {}
): AccountsTransferMergeResult {
  const idGenerator = options.idGenerator ?? (() => globalThis.crypto.randomUUID());
  const merged: AccountsStore = {
    ...store,
    accounts: [...store.accounts]
  };
  let insertedCount = 0;
  let updatedCount = 0;

  for (const account of importedAccounts) {
    if (!selectedAccountIds.has(account.id)) {
      continue;
    }

    const incoming: StoredAccount = {
      ...account,
      updatedAt: now,
      addedAt: account.addedAt > 0 ? account.addedAt : now
    };

    const existingIndex = merged.accounts.findIndex((existing) => storedAccountsMatch(existing, incoming));
    if (existingIndex >= 0) {
      const existing = merged.accounts[existingIndex];
      if (!existing) {
        continue;
      }

      merged.accounts[existingIndex] = {
        ...incoming,
        id: existing.id,
        addedAt: existing.addedAt
      };
      updatedCount += 1;
      continue;
    }

    if (merged.accounts.some((existing) => existing.id === incoming.id)) {
      incoming.id = idGenerator();
    }

    merged.accounts.push(incoming);
    insertedCount += 1;
  }

  return {
    store: merged,
    result: {
      insertedCount,
      updatedCount
    }
  };
}
