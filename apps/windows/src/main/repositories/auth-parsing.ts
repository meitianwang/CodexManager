import type { JSONValue } from "../../shared/models/json-value";
import { asJsonObject, isJsonObject, parseJsonValue } from "../../shared/models/json-value";
import { normalizedPrincipalId } from "../../shared/domain/account-identity";
import { displayTier, isPaidPlan, normalizedPlanType } from "../../shared/domain/account-plan-resolver";

export function tokenObjectFromAuth(auth: JSONValue): Record<string, JSONValue> | undefined {
  const root = asJsonObject(auth, "auth JSON");
  const tokens = root.tokens;
  if (tokens && isJsonObject(tokens)) {
    return tokens;
  }

  if (typeof root.access_token === "string" && typeof root.id_token === "string") {
    return root;
  }

  return undefined;
}

export function codexVisiblePlanFromAuth(auth: JSONValue): string | undefined {
  const tokens = tokenObjectFromAuth(auth);
  return planFromJwtToken(tokens?.access_token) ?? planFromJwtToken(tokens?.id_token);
}

export function refreshTokenFromAuth(auth: JSONValue): string | undefined {
  const tokens = tokenObjectFromAuth(auth);
  return normalizedString(typeof tokens?.refresh_token === "string" ? tokens.refresh_token : undefined);
}

export function authTokenNeedsPlanRepair(codexVisiblePlan: string | undefined, expectedPlan: string | undefined): boolean {
  if (!isPaidPlan(expectedPlan)) {
    return false;
  }

  const visibleTier = displayTier(codexVisiblePlan);
  if (!visibleTier) {
    return true;
  }

  const expectedTier = displayTier(expectedPlan);
  return visibleTier === "free" || (expectedTier !== undefined && visibleTier !== expectedTier);
}

export function decodeJwtPayload(token: string): JSONValue {
  const segments = token.split(".");
  const payload = segments[1];
  if (!payload) {
    throw new Error("id_token has an invalid JWT format");
  }

  let base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
  const remainder = base64.length % 4;
  if (remainder > 0) {
    base64 += "=".repeat(4 - remainder);
  }

  const decoded = Buffer.from(base64, "base64").toString("utf8");
  return parseJsonValue(JSON.parse(decoded), "JWT payload");
}

function planFromJwtToken(token: JSONValue | undefined): string | undefined {
  if (typeof token !== "string") {
    return undefined;
  }

  try {
    const payload = decodeJwtPayload(token);
    return normalizedPlanType(
      stringAtPath(["https://api.openai.com/auth", "chatgpt_plan_type"], payload) ?? stringAtPath(["plan_type"], payload)
    );
  } catch {
    return undefined;
  }
}

export function normalizedString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function stringAtPath(path: readonly string[], root: JSONValue | undefined): string | undefined {
  if (root === undefined) {
    return undefined;
  }

  let current = root;
  for (const key of path) {
    if (!isJsonObject(current)) {
      return undefined;
    }

    const next = current[key];
    if (next === undefined) {
      return undefined;
    }
    current = next;
  }

  return typeof current === "string" ? current : undefined;
}

export function resolvePrincipalID(options: {
  auth: JSONValue;
  claims?: JSONValue;
  email?: string;
  accountId?: string;
  fallbackPrincipalId?: string;
}): string | undefined {
  const candidates = [
    options.fallbackPrincipalId,
    stringAtPath(["tokens", "principal_id"], options.auth),
    stringAtPath(["principal_id"], options.auth),
    stringAtPath(["sub"], options.claims),
    stringAtPath(["https://api.openai.com/auth", "chatgpt_user_id"], options.claims),
    stringAtPath(["https://api.openai.com/auth", "user_id"], options.claims),
    stringAtPath(["user", "id"], options.claims),
    stringAtPath(["user_id"], options.claims),
    stringAtPath(["sub"], options.auth),
    stringAtPath(["user", "id"], options.auth),
    stringAtPath(["user_id"], options.auth)
  ];

  for (const candidate of candidates) {
    const normalized = normalizedString(candidate);
    if (normalized) {
      return normalizedPrincipalId(normalized, options.email, options.accountId ?? "");
    }
  }

  const normalizedAccountId = normalizedString(options.accountId);
  if (!normalizedAccountId) {
    return undefined;
  }

  return normalizedPrincipalId(undefined, options.email, normalizedAccountId);
}

export function extractTeamName(auth: JSONValue, claims: JSONValue | undefined, accountIdHint: string | undefined): string | undefined {
  const preferredIds = preferredWorkspaceIds(auth, claims, accountIdHint);
  const containerName =
    extractNameFromContainers(claims, preferredIds) ?? extractNameFromContainers(auth, preferredIds);
  if (containerName) {
    return containerName;
  }

  const claimPaths = [
    ["https://api.openai.com/auth", "chatgpt_team_name"],
    ["https://api.openai.com/auth", "chatgpt_workspace_slug"],
    ["https://api.openai.com/auth", "workspace_slug"],
    ["https://api.openai.com/auth", "team_slug"],
    ["https://api.openai.com/auth", "organization_slug"],
    ["https://api.openai.com/auth", "chatgpt_org_name"],
    ["https://api.openai.com/auth", "organization_name"],
    ["https://api.openai.com/auth", "org_name"],
    ["https://api.openai.com/auth", "team_name"],
    ["organization", "name"],
    ["org", "name"],
    ["team", "name"],
    ["workspace", "name"]
  ] as const;

  for (const path of claimPaths) {
    const value = normalizedTeamName(stringAtPath(path, claims));
    if (value) {
      return value;
    }
  }

  const authPaths = [
    ["tokens", "workspace_slug"],
    ["tokens", "team_slug"],
    ["tokens", "organization_slug"],
    ["organization", "name"],
    ["org", "name"],
    ["team", "name"],
    ["workspace", "name"],
    ["tokens", "organization_name"],
    ["tokens", "org_name"],
    ["tokens", "team_name"]
  ] as const;

  for (const path of authPaths) {
    const value = normalizedTeamName(stringAtPath(path, auth));
    if (value) {
      return value;
    }
  }

  const candidateKeys = new Set(["teamname", "organizationname", "orgname", "workspacename", "tenantname", "displayname"]);
  return findFirstString(claims, candidateKeys) ?? findFirstString(auth, candidateKeys);
}

interface WorkspaceCandidate {
  id?: string;
  displayName?: string;
  isDefault: boolean;
  isCurrent: boolean;
  isActive: boolean;
}

function normalizedTeamName(value: string | undefined): string | undefined {
  const normalized = normalizedString(value);
  if (!normalized || isPersonalName(normalized)) {
    return undefined;
  }
  return normalized;
}

function isPersonalName(value: string): boolean {
  const normalized = value.trim().toLowerCase().replaceAll(" ", "").replaceAll("-", "").replaceAll("_", "");
  return normalized === "personal" || normalized === "personalworkspace" || normalized === "myworkspace" || normalized === "个人" || normalized === "个人空间";
}

function normalizedKey(key: string): string {
  return key.replaceAll("_", "").replaceAll("-", "").toLowerCase();
}

function findFirstString(value: JSONValue | undefined, candidateKeys: Set<string>): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (isJsonObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (candidateKeys.has(normalizedKey(key))) {
        const match = normalizedTeamName(typeof item === "string" ? item : undefined);
        if (match) {
          return match;
        }
      }
    }

    for (const item of Object.values(value)) {
      const nested = findFirstString(item, candidateKeys);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findFirstString(item, candidateKeys);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function extractNameFromContainers(root: JSONValue | undefined, preferredIds: Set<string>): string | undefined {
  const candidates = collectWorkspaceCandidates(root);
  if (candidates.length === 0) {
    return undefined;
  }

  const matchedById = candidates.find((candidate) => candidate.id && preferredIds.has(candidate.id.toLowerCase()));
  const matchedDisplayName = normalizedTeamName(matchedById?.displayName);
  if (matchedDisplayName) {
    return matchedDisplayName;
  }

  const prioritized = [...candidates].sort((lhs, rhs) => scoreWorkspaceCandidate(rhs, preferredIds) - scoreWorkspaceCandidate(lhs, preferredIds));
  for (const candidate of prioritized) {
    const displayName = normalizedTeamName(candidate.displayName);
    if (displayName) {
      return displayName;
    }
  }

  return undefined;
}

function scoreWorkspaceCandidate(candidate: WorkspaceCandidate, preferredIds: Set<string>): number {
  let score = 0;
  if (candidate.id && preferredIds.has(candidate.id.toLowerCase())) {
    score += 100;
  }
  if (candidate.isCurrent) {
    score += 30;
  }
  if (candidate.isActive) {
    score += 20;
  }
  if (candidate.isDefault) {
    score += 5;
  }
  if (candidate.displayName && !isPersonalName(candidate.displayName)) {
    score += 10;
  }
  return score;
}

function collectWorkspaceCandidates(value: JSONValue | undefined): WorkspaceCandidate[] {
  if (value === undefined) {
    return [];
  }

  if (isJsonObject(value)) {
    const containerKeys = ["organizations", "orgs", "teams", "workspaces", "groups"];
    const candidates: WorkspaceCandidate[] = [];

    for (const key of containerKeys) {
      const items = value[key];
      if (!Array.isArray(items)) {
        continue;
      }

      for (const item of items) {
        if (!isJsonObject(item)) {
          continue;
        }

        candidates.push({
          id: extractString(item, ["id", "organization_id", "org_id", "workspace_id", "group_id"]),
          displayName: extractString(item, ["slug", "workspace_slug", "team_slug", "organization_slug", "name", "display_name", "displayName", "title", "label"]),
          isDefault: extractBool(item, ["is_default", "default"]),
          isCurrent: extractBool(item, ["is_current", "current", "selected"]),
          isActive: extractBool(item, ["is_active", "active"])
        });
      }
    }

    for (const nested of Object.values(value)) {
      candidates.push(...collectWorkspaceCandidates(nested));
    }

    return candidates;
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectWorkspaceCandidates);
  }

  return [];
}

function extractString(object: Record<string, JSONValue>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = object[key];
    const normalized = normalizedString(typeof value === "string" ? value : undefined);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function extractBool(object: Record<string, JSONValue>, keys: readonly string[]): boolean {
  return keys.some((key) => object[key] === true);
}

function preferredWorkspaceIds(auth: JSONValue, claims: JSONValue | undefined, accountIdHint: string | undefined): Set<string> {
  const hintPaths = [
    ["https://api.openai.com/auth", "chatgpt_org_id"],
    ["https://api.openai.com/auth", "chatgpt_organization_id"],
    ["https://api.openai.com/auth", "organization_id"],
    ["https://api.openai.com/auth", "org_id"],
    ["https://api.openai.com/auth", "active_organization_id"],
    ["https://api.openai.com/auth", "active_org_id"],
    ["https://api.openai.com/auth", "current_organization_id"],
    ["https://api.openai.com/auth", "default_organization_id"],
    ["tokens", "organization_id"],
    ["tokens", "org_id"],
    ["tokens", "active_organization_id"],
    ["tokens", "active_org_id"]
  ] as const;

  const ids = new Set<string>();
  const normalizedAccountId = normalizedString(accountIdHint)?.toLowerCase();
  if (normalizedAccountId) {
    ids.add(normalizedAccountId);
  }

  for (const path of hintPaths) {
    const claimValue = normalizedString(stringAtPath(path, claims))?.toLowerCase();
    if (claimValue) {
      ids.add(claimValue);
    }

    const authValue = normalizedString(stringAtPath(path, auth))?.toLowerCase();
    if (authValue) {
      ids.add(authValue);
    }
  }

  return ids;
}
