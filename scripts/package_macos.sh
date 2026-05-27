#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-local}"
ARTIFACTS_ROOT="${ARTIFACTS_ROOT:-$ROOT_DIR/artifacts/macos}"
BUILD_ROOT="${BUILD_ROOT:-$ROOT_DIR/build/package}"
PROJECT_PATH="${PROJECT_PATH:-CodexManager.xcodeproj}"
SCHEME="${SCHEME:-CodexManager}"
CONFIGURATION="${CONFIGURATION:-Release}"

log() {
  printf '[package_macos] %s\n' "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

case "$MODE" in
  local|release)
    ;;
  *)
    printf 'Usage: %s [local|release]\n' "$0" >&2
    exit 1
    ;;
esac

require_command xcodebuild
require_command codesign
require_command ditto
require_command xattr
require_command defaults
require_command shasum

mkdir -p "$ARTIFACTS_ROOT" "$BUILD_ROOT"

if [[ "$MODE" == "release" ]]; then
  log "Delegating to release_macos.sh"
  ARTIFACTS_ROOT="$ARTIFACTS_ROOT" BUILD_ROOT="$BUILD_ROOT" \
    "$ROOT_DIR/scripts/release_macos.sh"
  exit 0
fi

# Keep intermediate .app bundles out of Spotlight/Launchpad search results.
LOCAL_BUILD_ROOT="$BUILD_ROOT/local.noindex"
LOCAL_ARTIFACTS_ROOT="$ARTIFACTS_ROOT/local"
ARCHIVE_PATH="$LOCAL_BUILD_ROOT/$SCHEME.xcarchive"
DERIVED_DATA_PATH="$LOCAL_BUILD_ROOT/DerivedData"
EXPORT_DIR="$LOCAL_BUILD_ROOT/export"
DMG_STAGE_DIR="$LOCAL_BUILD_ROOT/dmg-staging"

[[ -n "$LOCAL_BUILD_ROOT" ]] && rm -rf "$LOCAL_BUILD_ROOT"
[[ -n "$LOCAL_ARTIFACTS_ROOT" ]] && rm -rf "$LOCAL_ARTIFACTS_ROOT"
mkdir -p "$LOCAL_ARTIFACTS_ROOT" "$EXPORT_DIR"

log "Archiving local macOS build"
xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -archivePath "$ARCHIVE_PATH" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  -destination "generic/platform=macOS" \
  archive \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=

APP_PATH="$(find "$ARCHIVE_PATH/Products/Applications" -maxdepth 1 -name '*.app' -print -quit)"
if [[ -z "$APP_PATH" ]]; then
  printf 'No archived .app bundle found in %s\n' "$ARCHIVE_PATH/Products/Applications" >&2
  exit 1
fi

APP_NAME="$(basename "$APP_PATH" .app)"
LOCAL_APP_PATH="$EXPORT_DIR/$APP_NAME.app"
/usr/bin/ditto --norsrc --noqtn "$APP_PATH" "$LOCAL_APP_PATH"
xattr -cr "$LOCAL_APP_PATH"

log "Applying ad-hoc signature for local preview"
codesign --force --deep --sign - "$LOCAL_APP_PATH"

APP_VERSION="$(defaults read "$LOCAL_APP_PATH/Contents/Info" CFBundleShortVersionString)"
ZIP_PATH="$LOCAL_ARTIFACTS_ROOT/${APP_NAME}-${APP_VERSION}-macOS-local.zip"
ZIP_SHA_PATH="$ZIP_PATH.sha256"
DMG_PATH="$LOCAL_ARTIFACTS_ROOT/${APP_NAME}-${APP_VERSION}-macOS-local.dmg"
DMG_SHA_PATH="$DMG_PATH.sha256"

log "Packaging local zip"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$LOCAL_APP_PATH" "$ZIP_PATH"
printf '  %s  %s\n' "$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')" "$(basename "$ZIP_PATH")" >"$ZIP_SHA_PATH"

log "Packaging local dmg"
rm -rf "$DMG_STAGE_DIR"
mkdir -p "$DMG_STAGE_DIR"
cp -R "$LOCAL_APP_PATH" "$DMG_STAGE_DIR/"
ln -s /Applications "$DMG_STAGE_DIR/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_STAGE_DIR" -ov -format UDZO "$DMG_PATH" >/dev/null
printf '  %s  %s\n' "$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')" "$(basename "$DMG_PATH")" >"$DMG_SHA_PATH"

log "Done"
log "App: $LOCAL_APP_PATH"
log "Zip: $ZIP_PATH"
log "Zip SHA256: $ZIP_SHA_PATH"
log "DMG: $DMG_PATH"
log "DMG SHA256: $DMG_SHA_PATH"
