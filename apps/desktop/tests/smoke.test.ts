import { describe, expect, it } from "vitest";
import { appInfo } from "@shared/app-info";

describe("desktop app scaffold", () => {
  it("exposes stable app metadata", () => {
    expect(appInfo.displayName).toBe("CodexManager");
    expect(appInfo.platform).toBe("desktop");
  });
});
