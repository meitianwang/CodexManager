const path = require("node:path");
const { MakerSquirrel } = require("@electron-forge/maker-squirrel");
const { MakerZIP } = require("@electron-forge/maker-zip");
const { AutoUnpackNativesPlugin } = require("@electron-forge/plugin-auto-unpack-natives");

const iconPath = path.resolve(__dirname, "assets", "icon");
const windowsIconPath = `${iconPath}.ico`;

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    appBundleId: "com.nik.mei.codexmanager",
    asar: true,
    executableName: "CodexManager",
    icon: iconPath,
    name: "CodexManager"
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "CodexManager",
      authors: "NikMei",
      description: "CodexManager desktop app",
      setupExe: "CodexManagerSetup.exe",
      setupIcon: windowsIconPath
    }),
    new MakerZIP({}, ["darwin"])
  ],
  plugins: [
    new AutoUnpackNativesPlugin({})
  ]
};
