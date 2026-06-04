const allowedExternalOrigins = new Set(["https://github.com"]);
const allowedExternalPathPrefixes = ["/meitianwang/CodexManager"];
const localhostNames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface NavigationPolicy {
  appFileURL: string;
  devServerURL?: string;
}

export function allowedDevServerURL(rawURL: string | undefined): string | undefined {
  if (!rawURL) {
    return undefined;
  }
  const url = parseURL(rawURL);
  if (!url || !isLocalHTTPURL(url) || hasCredentials(url)) {
    return undefined;
  }
  return url.toString();
}

export function isAllowedNavigationURL(rawURL: string, policy: NavigationPolicy): boolean {
  const url = parseURL(rawURL);
  if (!url) {
    return false;
  }

  const appFileURL = parseURL(policy.appFileURL);
  if (appFileURL && url.protocol === "file:" && appFileURL.protocol === "file:" && url.pathname === appFileURL.pathname) {
    return true;
  }

  const devServerURL = allowedDevServerURL(policy.devServerURL);
  if (!devServerURL) {
    return false;
  }
  const devURL = new URL(devServerURL);
  return url.origin === devURL.origin;
}

export function isAllowedExternalURL(rawURL: string): boolean {
  const url = parseURL(rawURL);
  if (!url || hasCredentials(url) || !allowedExternalOrigins.has(url.origin)) {
    return false;
  }
  return allowedExternalPathPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
}

function parseURL(rawURL: string): URL | undefined {
  try {
    return new URL(rawURL);
  } catch {
    return undefined;
  }
}

function isLocalHTTPURL(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") && localhostNames.has(url.hostname);
}

function hasCredentials(url: URL): boolean {
  return url.username.length > 0 || url.password.length > 0;
}
