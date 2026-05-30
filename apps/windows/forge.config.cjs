const { MakerSquirrel } = require("@electron-forge/maker-squirrel");
const { MakerZIP } = require("@electron-forge/maker-zip");
const { AutoUnpackNativesPlugin } = require("@electron-forge/plugin-auto-unpack-natives");

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "CodexManager",
    name: "CodexManager"
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "CodexManager",
      authors: "NikMei",
      description: "CodexManager for Windows"
    }),
    new MakerZIP({}, ["darwin", "linux"])
  ],
  plugins: [
    new AutoUnpackNativesPlugin({})
  ]
};
