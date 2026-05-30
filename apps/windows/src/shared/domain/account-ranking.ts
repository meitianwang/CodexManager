import type { AccountSummary } from "../models/accounts";
import type { UsageWindow } from "../models/usage";

const exhaustedThreshold = 100;

export function remainingScore(account: AccountSummary): number {
  const oneWeekUsed = account.usage?.oneWeek?.usedPercent ?? 100;
  const fiveHourUsed = account.usage?.fiveHour?.usedPercent ?? 100;
  const oneWeekRemaining = Math.max(0, 100 - oneWeekUsed);
  const fiveHourRemaining = Math.max(0, 100 - fiveHourUsed);
  return oneWeekRemaining * 0.7 + fiveHourRemaining * 0.3;
}

export function sortByRemaining(accounts: readonly AccountSummary[]): AccountSummary[] {
  return [...accounts].sort((left, right) => remainingScore(right) - remainingScore(left));
}

export function sortForDisplay(accounts: readonly AccountSummary[]): AccountSummary[] {
  return [...accounts].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) {
      return left.isCurrent ? -1 : 1;
    }

    const leftScore = remainingScore(left);
    const rightScore = remainingScore(right);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return left.addedAt - right.addedAt;
  });
}

export function pickBestAccount(accounts: readonly AccountSummary[]): AccountSummary | undefined {
  return sortByRemaining(accounts)[0];
}

export function isQuotaExhausted(account: AccountSummary): boolean {
  return isWindowExhausted(account.usage?.fiveHour) || isWindowExhausted(account.usage?.oneWeek);
}

export function pickAutoSwitchTarget(accounts: readonly AccountSummary[]): AccountSummary | undefined {
  const current = accounts.find((account) => account.isCurrent);
  if (!current || !isQuotaExhausted(current)) {
    return undefined;
  }

  return pickBestAccount(accounts.filter((account) => account.id !== current.id));
}

function isWindowExhausted(window: UsageWindow | undefined): boolean {
  return window !== undefined && window.usedPercent >= exhaustedThreshold;
}
