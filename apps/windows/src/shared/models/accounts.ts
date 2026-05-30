import type { JSONValue } from "./json-value";
import type { UsageSnapshot } from "./usage";

export interface AccountsStore {
  version: number;
  accounts: StoredAccount[];
  currentSelection?: CurrentAccountSelection;
}

export interface CurrentAccountSelection {
  accountId: string;
  selectedAt: number;
  sourceDeviceID: string;
  accountKey?: string;
}

export interface StoredAccount {
  id: string;
  label: string;
  email?: string;
  accountId: string;
  planType?: string;
  teamName?: string;
  teamAlias?: string;
  authJson: JSONValue;
  addedAt: number;
  updatedAt: number;
  usage?: UsageSnapshot;
  usageError?: string;
  principalId?: string;
}

export interface AccountSummary {
  id: string;
  label: string;
  email?: string;
  accountId: string;
  planType?: string;
  teamName?: string;
  teamAlias?: string;
  addedAt: number;
  updatedAt: number;
  usage?: UsageSnapshot;
  usageError?: string;
  isCurrent: boolean;
  principalId?: string;
  accountKey: string;
  effectivePlanType: string;
  normalizedPlanLabel: string;
  displayTeamName?: string;
  shouldDisplayWorkspaceTag: boolean;
}

export interface CurrentAccountSelectionPullResult {
  didUpdateSelection: boolean;
  changedCurrentAccount: boolean;
  accountId?: string;
  accountKey?: string;
}

export interface AccountsCloudSyncPullResult {
  didUpdateAccounts: boolean;
  remoteSyncedAt?: number;
}

export function emptyAccountsStore(): AccountsStore {
  return {
    version: 1,
    accounts: []
  };
}
