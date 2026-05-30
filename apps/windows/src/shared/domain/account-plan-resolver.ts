export function normalizedPlanType(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

export function preferredPlanType(
  planType: string | undefined,
  usagePlanType: string | undefined,
  fallback?: string
): string | undefined {
  return normalizedPlanType(usagePlanType) ?? normalizedPlanType(planType) ?? normalizedPlanType(fallback);
}

export function effectivePlanType(planType: string | undefined, usagePlanType: string | undefined): string {
  return preferredPlanType(planType, usagePlanType, "team") ?? "team";
}

export function displayTier(value: string | undefined): string | undefined {
  switch (normalizedPlanType(value)) {
    case "pro":
    case "prolite":
    case "pro_lite":
      return "pro";
    case "plus":
      return "plus";
    case "free":
    case "go":
      return "free";
    case "team":
    case "business":
    case "enterprise":
      return "team";
    case undefined:
      return undefined;
    default:
      return normalizedPlanType(value);
  }
}

export function isPaidPlan(value: string | undefined): boolean {
  switch (displayTier(value)) {
    case "pro":
    case "plus":
    case "team":
      return true;
    default:
      return false;
  }
}

export function normalizedPlanLabel(planType: string): string {
  switch (planType) {
    case "free":
      return "FREE";
    case "plus":
      return "PLUS";
    case "pro":
    case "prolite":
    case "pro_lite":
      return "PRO";
    case "enterprise":
      return "ENTERPRISE";
    case "business":
      return "BUSINESS";
    default:
      return "TEAM";
  }
}
