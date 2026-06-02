import type { StoredAccount, AccountSummary, CurrentAccountSelection } from "../models/accounts";
import type { ExtractedAuth } from "../models/auth";

const separator = "|";

export interface AccountIdentityInput {
  principalId?: string;
  email?: string;
  accountId: string;
}

export function normalizedAccountId(value: string): string {
  return value.trim();
}

export function normalizedEmail(value: string | undefined): string | undefined {
  const normalized = normalizedIdentifier(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.includes("@") ? normalized.toLowerCase() : normalized;
}

export function normalizedPrincipalId(
  principalId: string | undefined,
  email: string | undefined,
  accountId: string
): string {
  const normalized = normalizedIdentifier(principalId);
  if (normalized) {
    return normalized.includes("@") ? normalized.toLowerCase() : normalized;
  }

  const normalizedAccountEmail = normalizedEmail(email);
  if (normalizedAccountEmail) {
    return normalizedAccountEmail;
  }

  return normalizedAccountId(accountId);
}

export function accountKey(input: AccountIdentityInput): string {
  return `${normalizedPrincipalId(input.principalId, input.email, input.accountId)}${separator}${normalizedAccountId(
    input.accountId
  )}`;
}

export function accountKeyForStoredAccount(account: StoredAccount): string {
  return accountKey(account);
}

export function accountKeyForSummary(account: AccountSummary): string {
  return accountKey(account);
}

export function accountKeyForExtractedAuth(auth: ExtractedAuth): string {
  return accountKey(auth);
}

export function normalizedSelectionKey(value: string | undefined): string | undefined {
  return normalizedIdentifier(value);
}

export function storedAccountMatchesExtractedAuth(stored: StoredAccount, extracted: ExtractedAuth): boolean {
  if (accountKeyForStoredAccount(stored) === accountKeyForExtractedAuth(extracted)) {
    return true;
  }

  if (normalizedAccountId(stored.accountId) !== normalizedAccountId(extracted.accountId)) {
    return false;
  }

  const storedEmail = normalizedEmail(stored.email);
  const extractedEmail = normalizedEmail(extracted.email);
  if (storedEmail && extractedEmail && storedEmail === extractedEmail) {
    return true;
  }

  return !hasExplicitPrincipal(stored.principalId, stored.email);
}

export function storedAccountsMatch(lhs: StoredAccount, rhs: StoredAccount): boolean {
  if (accountKeyForStoredAccount(lhs) === accountKeyForStoredAccount(rhs)) {
    return true;
  }

  if (normalizedAccountId(lhs.accountId) !== normalizedAccountId(rhs.accountId)) {
    return false;
  }

  const lhsEmail = normalizedEmail(lhs.email);
  const rhsEmail = normalizedEmail(rhs.email);
  if (lhsEmail && rhsEmail && lhsEmail === rhsEmail) {
    return true;
  }

  return !hasExplicitPrincipal(lhs.principalId, lhs.email) || !hasExplicitPrincipal(rhs.principalId, rhs.email);
}

export function selectionMatchesAccount(selection: CurrentAccountSelection, account: StoredAccount): boolean {
  const selectionKey = normalizedSelectionKey(selection.accountKey);
  if (selectionKey) {
    return selectionKey === accountKeyForStoredAccount(account);
  }
  return normalizedAccountId(selection.accountId) === normalizedAccountId(account.accountId);
}

export function preferredMatchIndex(extracted: ExtractedAuth, accounts: readonly StoredAccount[]): number | undefined {
  const extractedKey = accountKeyForExtractedAuth(extracted);
  const exactKeyIndex = accounts.findIndex((account) => accountKeyForStoredAccount(account) === extractedKey);
  if (exactKeyIndex >= 0) {
    return exactKeyIndex;
  }

  const normalizedExtractedAccountId = normalizedAccountId(extracted.accountId);
  const normalizedExtractedEmail = normalizedEmail(extracted.email);
  if (normalizedExtractedEmail) {
    const emailMatchIndex = accounts.findIndex(
      (account) =>
        normalizedAccountId(account.accountId) === normalizedExtractedAccountId &&
        normalizedEmail(account.email) === normalizedExtractedEmail
    );
    if (emailMatchIndex >= 0) {
      return emailMatchIndex;
    }
  }

  const wildcardMatches = accounts
    .map((account, index) => ({ account, index }))
    .filter(
      ({ account }) =>
        normalizedAccountId(account.accountId) === normalizedExtractedAccountId &&
        !hasExplicitPrincipal(account.principalId, account.email)
    );

  return wildcardMatches.length === 1 ? wildcardMatches[0]?.index : undefined;
}

export function hasExplicitPrincipal(principalId: string | undefined, email: string | undefined): boolean {
  return normalizedIdentifier(principalId) !== undefined || normalizedEmail(email) !== undefined;
}

function normalizedIdentifier(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
