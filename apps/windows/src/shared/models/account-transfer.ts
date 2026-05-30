import type { StoredAccount } from "./accounts";

export const accountsTransferFormatIdentifier = "com.nik.mei.codexmanager.accounts";
export const accountsTransferCurrentVersion = 1;

export interface AccountsTransferPackage {
  format: string;
  version: number;
  exportedAt: number;
  accounts: StoredAccount[];
}

export interface AccountsImportResult {
  insertedCount: number;
  updatedCount: number;
}

export interface AccountTransferSelectableItem {
  id: string;
  label: string;
  email?: string;
  accountId: string;
  planLabel: string;
  teamName?: string;
  isCurrent: boolean;
}
