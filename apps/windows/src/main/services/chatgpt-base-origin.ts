import { readFile } from "node:fs/promises";

const defaultBaseOrigin = "https://chatgpt.com";

export async function resolveChatGPTBaseOrigin(configPath: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return defaultBaseOrigin;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("chatgpt_base_url")) {
      continue;
    }

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex < 0) {
      continue;
    }

    const value = trimmed
      .slice(equalIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\/+$/g, "");
    if (value) {
      return value;
    }
  }

  return defaultBaseOrigin;
}

export async function resolveForcedWorkspaceID(configPath: string): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return undefined;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("forced_chatgpt_workspace_id")) {
      continue;
    }

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex < 0) {
      continue;
    }

    const value = trimmed
      .slice(equalIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function removeSuffix(value: string, suffix: string): string | undefined {
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : undefined;
}
