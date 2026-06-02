import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileSystemPaths } from "./file-system-paths";
import { readTextFile, writeFileAtomically } from "./atomic-file-writer";
import { stableStringify } from "./stable-json";
import type { JSONValue } from "../../shared/models/json-value";
import { asJsonObject, isJsonObject, parseJsonValue } from "../../shared/models/json-value";
import type { ChatGPTOAuthTokens, ExtractedAuth } from "../../shared/models/auth";
import {
  decodeJwtPayload,
  extractTeamName,
  resolvePrincipalID,
  stringAtPath,
  tokenObjectFromAuth
} from "./auth-parsing";

const topLevelTokenKeys = ["access_token", "refresh_token", "id_token", "account_id"] as const;

export interface AuthFileRepositoryOptions {
  now?: () => Date;
}

export class AuthFileRepository {
  private readonly now: () => Date;

  constructor(
    private readonly paths: Pick<FileSystemPaths, "codexAuthPath">,
    options: AuthFileRepositoryOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async readCurrentAuth(): Promise<JSONValue> {
    try {
      return await this.readAuth(this.paths.codexAuthPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new Error("auth.json was not found");
      }
      throw error;
    }
  }

  async readCurrentAuthOptional(): Promise<JSONValue | undefined> {
    try {
      return await this.readAuth(this.paths.codexAuthPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async readAuth(path: string): Promise<JSONValue> {
    const raw = await readTextFile(path);
    return parseJsonValue(JSON.parse(raw), "auth JSON");
  }

  async writeCurrentAuth(auth: JSONValue): Promise<void> {
    const normalizedAuth = normalizeCodexCurrentAuth(auth, this.now);
    await mkdir(dirname(this.paths.codexAuthPath), { recursive: true });
    await writeFileAtomically(stableStringify(normalizedAuth), this.paths.codexAuthPath);
  }

  async removeCurrentAuth(): Promise<void> {
    await rm(this.paths.codexAuthPath, { force: true });
  }

  makeChatGPTAuth(tokens: ChatGPTOAuthTokens): JSONValue {
    const claims = decodeJwtPayload(tokens.idToken);
    const accountId = stringAtPath(["https://api.openai.com/auth", "chatgpt_account_id"], claims);
    const principalId = resolvePrincipalID({
      auth: {},
      claims,
      email: stringAtPath(["email"], claims),
      accountId
    });

    const tokenObject: Record<string, JSONValue> = {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      id_token: tokens.idToken
    };

    if (accountId) {
      tokenObject.account_id = accountId;
    }
    if (principalId) {
      tokenObject.principal_id = principalId;
    }

    const root: Record<string, JSONValue> = {
      auth_mode: "chatgpt",
      last_refresh: this.now().toISOString(),
      tokens: tokenObject
    };

    if (tokens.apiKey) {
      root.OPENAI_API_KEY = tokens.apiKey;
    }

    return root;
  }

  replacingChatGPTTokens(auth: JSONValue, tokens: ChatGPTOAuthTokens): JSONValue {
    const root = { ...asJsonObject(auth, "auth JSON") };
    const refreshedRoot = asJsonObject(this.makeChatGPTAuth(tokens), "refreshed auth JSON");
    const refreshedTokens = refreshedRoot.tokens;
    const refreshedAuthMode = refreshedRoot.auth_mode;
    const refreshedLastRefresh = refreshedRoot.last_refresh;
    if (!isJsonObject(refreshedTokens)) {
      throw new Error("refreshed auth tokens are invalid");
    }
    if (typeof refreshedAuthMode !== "string" || typeof refreshedLastRefresh !== "string") {
      throw new Error("refreshed auth metadata is invalid");
    }

    root.auth_mode = refreshedAuthMode;
    root.last_refresh = refreshedLastRefresh;
    root.tokens = refreshedTokens;
    if (refreshedRoot.OPENAI_API_KEY !== undefined) {
      root.OPENAI_API_KEY = refreshedRoot.OPENAI_API_KEY;
    }
    return root;
  }

  extractAuth(auth: JSONValue): ExtractedAuth {
    const root = asJsonObject(auth, "auth JSON");
    const mode = typeof root.auth_mode === "string" ? root.auth_mode.toLowerCase() : "";
    const tokens = tokenObjectFromAuth(auth);
    if (!tokens) {
      if (mode && mode !== "chatgpt" && mode !== "chatgpt_auth_tokens") {
        throw new Error("auth JSON is not in ChatGPT mode");
      }
      throw new Error("auth JSON does not contain ChatGPT tokens");
    }

    const accessToken = stringValue(tokens.access_token, "access_token");
    const idToken = stringValue(tokens.id_token, "id_token");
    let accountId = optionalStringValue(tokens.account_id);
    let principalId = optionalStringValue(tokens.principal_id);
    let email: string | undefined;
    let planType: string | undefined;
    let teamName: string | undefined;
    let claims: JSONValue | undefined;

    try {
      claims = decodeJwtPayload(idToken);
      email = stringAtPath(["email"], claims);
      accountId ??= stringAtPath(["https://api.openai.com/auth", "chatgpt_account_id"], claims);
      principalId ??= resolvePrincipalID({ auth, claims, email, accountId });
      planType = stringAtPath(["https://api.openai.com/auth", "chatgpt_plan_type"], claims);
      teamName = extractTeamName(auth, claims, accountId);
    } catch {
      teamName = extractTeamName(auth, undefined, accountId);
    }

    if (!accountId) {
      throw new Error("auth JSON is missing chatgpt_account_id");
    }

    const finalPrincipalId = resolvePrincipalID({
      auth,
      claims,
      email,
      accountId,
      fallbackPrincipalId: principalId
    });

    return {
      accountId,
      accessToken,
      email,
      planType,
      teamName,
      principalId: finalPrincipalId
    };
  }
}

export function normalizeCodexCurrentAuth(auth: JSONValue, now: () => Date = () => new Date()): JSONValue {
  const root = { ...asJsonObject(auth, "auth JSON") };
  const tokens = normalizedTokens(root);

  root.auth_mode = normalizedAuthMode(root.auth_mode);
  root.tokens = tokens;
  for (const key of topLevelTokenKeys) {
    delete root[key];
  }
  root.last_refresh = normalizedLastRefresh(root.last_refresh, now);
  return root;
}

function normalizedTokens(root: Record<string, JSONValue>): Record<string, JSONValue> {
  const existingTokens = root.tokens && isJsonObject(root.tokens) ? root.tokens : {};
  const tokens: Record<string, JSONValue> = { ...existingTokens };

  for (const key of topLevelTokenKeys) {
    if (tokens[key] === undefined && root[key] !== undefined) {
      tokens[key] = root[key];
    }
  }

  stringValue(tokens.access_token, "access_token");
  stringValue(tokens.id_token, "id_token");
  return tokens;
}

function normalizedAuthMode(value: JSONValue | undefined): string {
  return typeof value === "string" && value.trim() ? value.trim() : "chatgpt";
}

function normalizedLastRefresh(value: JSONValue | undefined, now: () => Date): string {
  if (typeof value !== "string" || !value.trim()) {
    return now().toISOString();
  }

  const parsed = parseTimestamp(value.trim());
  return parsed ? parsed.toISOString() : now().toISOString();
}

function parseTimestamp(value: string): Date | undefined {
  const candidates = hasExplicitTimezone(value) ? [value] : [value, `${value}Z`];
  for (const candidate of candidates) {
    const timestamp = Date.parse(candidate);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp);
    }
  }
  return undefined;
}

function hasExplicitTimezone(value: string): boolean {
  return /(Z|[+-]\d{2}:\d{2})$/.test(value);
}

function stringValue(value: JSONValue | undefined, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`auth JSON is missing ${label}`);
  }
  return value;
}

function optionalStringValue(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
