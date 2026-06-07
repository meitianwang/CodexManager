import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function assetPath(relativePath) {
  return join(appRoot, relativePath);
}

function readAsset(relativePath) {
  const path = assetPath(relativePath);
  try {
    return readFileSync(path);
  } catch (error) {
    throw new Error(`Required package asset is missing: ${relativePath}`, { cause: error });
  }
}

function assertMagic(relativePath, expected) {
  const bytes = readAsset(relativePath);
  const actual = bytes.subarray(0, expected.length);
  if (!actual.equals(Buffer.from(expected))) {
    throw new Error(`Package asset ${relativePath} has an unexpected file signature.`);
  }
  if (statSync(assetPath(relativePath)).size < 1024) {
    throw new Error(`Package asset ${relativePath} is unexpectedly small.`);
  }
}

assertMagic("assets/icon.png", [0x89, 0x50, 0x4e, 0x47]);
assertMagic("assets/icon.ico", [0x00, 0x00, 0x01, 0x00]);
assertMagic("assets/icon.icns", Buffer.from("icns", "ascii"));

const forgeConfig = require(join(appRoot, "forge.config.cjs"));
if (forgeConfig.packagerConfig?.icon !== assetPath("assets/icon")) {
  throw new Error("Electron Forge must use the extensionless assets/icon path for platform-specific package icons.");
}
if (makerConfig(forgeConfig, "squirrel")?.setupIcon !== assetPath("assets/icon.ico")) {
  throw new Error("Electron Forge must wire the Windows .ico asset into the Squirrel setup executable.");
}
const squirrelPlatforms = platformsForMaker(forgeConfig, "squirrel");
if (!sameStringSet(squirrelPlatforms, ["win32"])) {
  throw new Error("Electron Forge Squirrel packaging must target Windows only.");
}
const zipPlatforms = platformsForMaker(forgeConfig, "zip");
if (!sameStringSet(zipPlatforms, ["darwin"])) {
  throw new Error("Electron Forge ZIP packaging must target macOS only until Linux release hardening is requested.");
}
if (zipPlatforms.includes("linux")) {
  throw new Error("Electron Forge must not expose Linux ZIP packaging while Linux is unsupported.");
}

console.log("Desktop package assets verified: icon.png, icon.ico, icon.icns");

function makerConfig(forgeConfig, makerName) {
  return findMaker(forgeConfig, makerName)?.configOrConfigFetcher;
}

function platformsForMaker(forgeConfig, makerName) {
  const maker = findMaker(forgeConfig, makerName);
  if (!maker) {
    return [];
  }
  return maker.platformsToMakeOn ?? maker.defaultPlatforms ?? [];
}

function findMaker(forgeConfig, makerName) {
  return forgeConfig.makers?.find((maker) => maker.name === makerName);
}

function sameStringSet(actual, expected) {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}
