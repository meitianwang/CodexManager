export interface UsageWindowRaw {
  usedPercent: number;
  limitWindowSeconds: number;
  resetAt?: number;
}

export function pickNearestWindow(
  windows: readonly UsageWindowRaw[],
  targetSeconds: number
): UsageWindowRaw | undefined {
  let selected: UsageWindowRaw | undefined;
  for (const window of windows) {
    if (!selected || distance(window, targetSeconds) < distance(selected, targetSeconds)) {
      selected = window;
    }
  }
  return selected;
}

function distance(window: UsageWindowRaw, targetSeconds: number): number {
  return Math.abs(window.limitWindowSeconds - targetSeconds);
}
