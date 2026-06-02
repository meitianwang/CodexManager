import { createHash, randomBytes } from "node:crypto";

export interface PKCECodes {
  codeVerifier: string;
  codeChallenge: string;
}

export function makePKCECodes(): PKCECodes {
  const codeVerifier = randomBase64URL(64);
  const codeChallenge = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function randomBase64URL(byteCount: number): string {
  return base64UrlEncode(randomBytes(byteCount));
}

function base64UrlEncode(data: Buffer): string {
  return data.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
