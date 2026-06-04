import { describe, expect, it } from "vitest";
import { allowedDevServerURL, isAllowedExternalURL, isAllowedNavigationURL } from "../src/main/window-security";

describe("Electron window security", () => {
  it("allows only local dev server URLs", () => {
    expect(allowedDevServerURL("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173/");
    expect(allowedDevServerURL("http://localhost:5173")).toBe("http://localhost:5173/");
    expect(allowedDevServerURL("http://[::1]:5173")).toBe("http://[::1]:5173/");
    expect(allowedDevServerURL("https://example.com")).toBeUndefined();
    expect(allowedDevServerURL("http://user:pass@127.0.0.1:5173")).toBeUndefined();
    expect(allowedDevServerURL("file:///tmp/index.html")).toBeUndefined();
  });

  it("blocks navigation away from the packaged renderer or local dev origin", () => {
    const packagedPolicy = {
      appFileURL: "file:///Applications/CodexManager.app/Contents/Resources/app/dist/renderer/index.html"
    };
    const devPolicy = {
      ...packagedPolicy,
      devServerURL: "http://127.0.0.1:5173"
    };

    expect(isAllowedNavigationURL(`${packagedPolicy.appFileURL}#/settings`, packagedPolicy)).toBe(true);
    expect(isAllowedNavigationURL("file:///etc/passwd", packagedPolicy)).toBe(false);
    expect(isAllowedNavigationURL("http://127.0.0.1:5173/accounts", devPolicy)).toBe(true);
    expect(isAllowedNavigationURL("http://127.0.0.1:3000/accounts", devPolicy)).toBe(false);
    expect(isAllowedNavigationURL("https://example.com", devPolicy)).toBe(false);
  });

  it("opens only the repository URL externally", () => {
    expect(isAllowedExternalURL("https://github.com/meitianwang/CodexManager")).toBe(true);
    expect(isAllowedExternalURL("https://github.com/meitianwang/CodexManager/issues")).toBe(true);
    expect(isAllowedExternalURL("https://github.com/openai/codex")).toBe(false);
    expect(isAllowedExternalURL("http://github.com/meitianwang/CodexManager")).toBe(false);
    expect(isAllowedExternalURL("javascript:alert(1)")).toBe(false);
  });
});
