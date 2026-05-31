import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { proxyAvailableModels, proxyEndpoints } from "../src/shared/models/proxy";
import { appLocales, editorAppIds } from "../src/shared/models/settings";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("macOS source parity", () => {
  it("keeps Windows proxy models aligned with macOS", () => {
    const swift = readSwiftSource("Sources/CodexManager/Features/Proxy/ProxyPageModel.swift");

    expect(proxyAvailableModels).toEqual(readSwiftStringArray(swift, "proxyAvailableModels"));
  });

  it("keeps Windows proxy endpoints aligned with macOS", () => {
    const swift = readSwiftSource("Sources/CodexManager/Features/Proxy/ProxyPageModel.swift");

    expect(proxyEndpoints.map((endpoint) => endpoint.path)).toEqual(
      readSwiftEnumRawStringValues(swift, "ProxyEndpoint")
    );
    expect(proxyEndpoints.map((endpoint) => endpoint.method)).toEqual(
      proxyEndpoints.map(() => "POST")
    );
  });

  it("keeps Windows language choices aligned with macOS", () => {
    const swift = readSwiftSource("Sources/CodexManager/Domain/AppLocale.swift");

    expect(appLocales).toEqual(readSwiftEnumRawStringValues(swift, "AppLocale"));
  });

  it("keeps Windows editor restart targets aligned with macOS", () => {
    const swift = readSwiftSource("Sources/CodexManager/Domain/AppModels.swift");

    expect(editorAppIds).toEqual(readSwiftEnumRawStringValues(swift, "EditorAppID"));
  });
});

function readSwiftSource(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function readSwiftStringArray(source: string, constantName: string): string[] {
  const pattern = new RegExp(`let\\s+${constantName}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
  const body = pattern.exec(source)?.[1];
  if (!body) {
    throw new Error(`Swift string array ${constantName} was not found`);
  }
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
}

function readSwiftEnumRawStringValues(source: string, enumName: string): string[] {
  const pattern = new RegExp(`enum\\s+${enumName}\\b[\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`);
  const body = pattern.exec(source)?.[1];
  if (!body) {
    throw new Error(`Swift enum ${enumName} was not found`);
  }
  return [...body.matchAll(/case\s+\w+(?:\s*=\s*"([^"]+)")?/g)].map(
    (match) => match[1] ?? match[0].replace(/^case\s+/, "")
  );
}
