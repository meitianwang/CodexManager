export interface UsageSnapshot {
  fetchedAt: number;
  planType?: string;
  fiveHour?: UsageWindow;
  oneWeek?: UsageWindow;
  credits?: CreditSnapshot;
}

export interface UsageWindow {
  usedPercent: number;
  windowSeconds: number;
  resetAt?: number;
}

export interface CreditSnapshot {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string;
}
