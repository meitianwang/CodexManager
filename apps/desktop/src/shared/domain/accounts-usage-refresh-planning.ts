import type { AccountSummary } from "../models/accounts";
import type { UsageSnapshot, UsageWindow } from "../models/usage";

const defaultNonCurrentResetLeadTimeSeconds = 60;

export function targetUsageRefreshAccountIds(
  accounts: readonly AccountSummary[],
  now: number,
  nonCurrentResetLeadTimeSeconds = defaultNonCurrentResetLeadTimeSeconds
): string[] {
  const selectedIds: string[] = [];
  const currentAccount = accounts.find((account) => account.isCurrent);
  if (currentAccount) {
    selectedIds.push(currentAccount.id);
  }

  for (const account of accounts) {
    if (account.isCurrent || !shouldRefreshNonCurrentAccount(account, now, nonCurrentResetLeadTimeSeconds)) {
      continue;
    }
    selectedIds.push(account.id);
  }

  return [...new Set(selectedIds)];
}

function shouldRefreshNonCurrentAccount(
  account: AccountSummary,
  now: number,
  nonCurrentResetLeadTimeSeconds: number
): boolean {
  if (account.usageError?.trim()) {
    return true;
  }

  return usageWindows(account.usage).some((window) => {
    if (window.resetAt === undefined) {
      return false;
    }
    const remainingSeconds = window.resetAt - now;
    return remainingSeconds >= 0 && remainingSeconds <= nonCurrentResetLeadTimeSeconds;
  });
}

function usageWindows(usage: UsageSnapshot | undefined): UsageWindow[] {
  return [usage?.fiveHour, usage?.oneWeek].filter((window): window is UsageWindow => window !== undefined);
}
