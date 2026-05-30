import type { AccountSummary, AccountsStore, StoredAccount } from "../models/accounts";
import { accountKeyForStoredAccount, normalizedAccountId, normalizedSelectionKey } from "./account-identity";
import { effectivePlanType, normalizedPlanLabel } from "./account-plan-resolver";

export function accountSummaries(store: AccountsStore, currentAccountKey?: string): AccountSummary[] {
  const resolvedCurrentAccountKey = resolveCurrentAccountKey(store, currentAccountKey);
  return store.accounts.map((account) => toAccountSummary(account, resolvedCurrentAccountKey));
}

export function toAccountSummary(account: StoredAccount, resolvedCurrentAccountKey?: string): AccountSummary {
  const accountKey = accountKeyForStoredAccount(account);
  const effective = effectivePlanType(account.planType, account.usage?.planType);
  const displayTeamName = account.teamAlias?.trim() || account.teamName?.trim() || undefined;
  const planLabel = normalizedPlanLabel(effective);

  return {
    id: account.id,
    label: account.label,
    email: account.email,
    accountId: account.accountId,
    planType: account.planType,
    teamName: account.teamName,
    teamAlias: account.teamAlias,
    addedAt: account.addedAt,
    updatedAt: account.updatedAt,
    usage: account.usage,
    usageError: account.usageError,
    isCurrent: resolvedCurrentAccountKey === accountKey,
    principalId: account.principalId,
    accountKey,
    effectivePlanType: effective,
    normalizedPlanLabel: planLabel,
    displayTeamName,
    shouldDisplayWorkspaceTag:
      displayTeamName !== undefined && (planLabel === "TEAM" || planLabel === "BUSINESS" || planLabel === "ENTERPRISE")
  };
}

function resolveCurrentAccountKey(store: AccountsStore, currentAccountKey?: string): string | undefined {
  const normalizedCurrentAccountKey = normalizedSelectionKey(currentAccountKey);
  if (normalizedCurrentAccountKey && store.accounts.some((account) => accountKeyForStoredAccount(account) === normalizedCurrentAccountKey)) {
    return normalizedCurrentAccountKey;
  }

  const selectionKey = normalizedSelectionKey(store.currentSelection?.accountKey);
  if (selectionKey && store.accounts.some((account) => accountKeyForStoredAccount(account) === selectionKey)) {
    return selectionKey;
  }

  const selectionAccountId = store.currentSelection?.accountId;
  if (selectionAccountId) {
    const matches = store.accounts.filter(
      (account) => normalizedAccountId(account.accountId) === normalizedAccountId(selectionAccountId)
    );
    if (matches.length === 1) {
      const match = matches[0];
      return match ? accountKeyForStoredAccount(match) : undefined;
    }
  }

  return undefined;
}
