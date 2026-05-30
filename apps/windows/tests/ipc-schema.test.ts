import { describe, expect, it } from "vitest";
import { parseIpcInput, proxyStartSchema, settingsPatchSchema, switchAccountSchema } from "../src/shared/ipc/schema";

describe("IPC schema validation", () => {
  it("accepts switch requests with an optional workspace path", () => {
    expect(
      parseIpcInput(switchAccountSchema, {
        id: "account-1",
        workspacePath: String.raw`C:\workspaces\demo`
      })
    ).toEqual({
      id: "account-1",
      workspacePath: String.raw`C:\workspaces\demo`
    });
  });

  it("rejects invalid proxy ports", () => {
    expect(() => parseIpcInput(proxyStartSchema, { port: 80_000 })).toThrow();
  });

  it("rejects unknown settings keys", () => {
    expect(() =>
      parseIpcInput(settingsPatchSchema, {
        launchAtStartup: true,
        macOnlyDockMode: true
      })
    ).toThrow();
  });
});
