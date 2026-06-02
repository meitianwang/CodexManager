# Deprecated Swift macOS Packaging Workflow

The native Swift macOS app is deprecated and is no longer the CodexManager desktop release target. Use the Electron desktop release flow in `docs/release-desktop.md` for current macOS releases.

This document is retained only for historical Swift packaging reference until the Swift sources and scripts are removed in a later cleanup.

## Scope
- Legacy Swift-only flow using `scripts/package_macos.sh`
- Keeps outputs under `artifacts/macos/`
- Keeps intermediate build/archive files under `build/package/`
- Supports local preview packaging and signed release packaging

## Entrypoints

### Local preview package
Builds an ad-hoc signed app for local verification and writes artifacts to `artifacts/macos/local/`.

```bash
./scripts/package_macos.sh local
```

Outputs:
- `artifacts/macos/local/CodexManager-<version>-macOS-local.zip`
- `artifacts/macos/local/CodexManager-<version>-macOS-local.dmg`
- matching `.sha256` files

### Release package
Delegates to `scripts/release_macos.sh` and writes artifacts to `artifacts/macos/release/`.

```bash
./scripts/package_macos.sh release
```

## Release Prerequisites
- Xcode command line tools
- A valid `Developer ID Application` certificate in the local keychain
- A matching macOS Developer ID provisioning profile for `com.nik.mei.codexmanager`
- One notarization path configured:
  - `asc auth login`
  - or a `notarytool` keychain profile

## Recommended Release Flow
```bash
DEVELOPMENT_TEAM="KLU8GF65GP" \
NOTARIZE_WITH=asc \
CREATE_GITHUB_RELEASE=1 \
./scripts/package_macos.sh release
```

## Notarization Backends

### `asc`
Use this when `asc auth login` is already configured:
```bash
NOTARIZE_WITH=asc ./scripts/package_macos.sh release
```

### `notarytool`
Use this when a keychain profile already exists:
```bash
NOTARIZE_WITH=notarytool \
NOTARY_PROFILE="your-notary-profile" \
./scripts/package_macos.sh release
```

### Skip notarization
Useful for local validation only:
```bash
NOTARIZE_WITH=skip ./scripts/package_macos.sh release
```

## Useful Environment Variables
- `PROJECT_PATH`
- `SCHEME`
- `CONFIGURATION`
- `DEVELOPMENT_TEAM`
- `CODESIGN_IDENTITY`
- `SIGNING_STYLE`
- `PROVISIONING_PROFILE_SPECIFIER`
- `PRODUCT_BUNDLE_IDENTIFIER`
- `ARTIFACTS_ROOT`
- `BUILD_ROOT`
- `WORK_ROOT`
- `KEEP_WORK_ROOT`
- `AUTO_DETECT_PROFILE`
- `NOTARIZE_WITH`
- `NOTARY_PROFILE`
- `CREATE_GITHUB_RELEASE`
- `GITHUB_REPOSITORY`
- `GH_RELEASE_NOTES`

## Output
- Local preview packages under `artifacts/macos/local/`
- Release packages under `artifacts/macos/release/`
- Intermediate archives and export trees under `build/package/`

## Notes
- `scripts/package_macos.sh` is the command you should run manually.
- `scripts/release_macos.sh` remains the lower-level signed release engine.
- The script uses `xcodebuild archive` and `xcodebuild -exportArchive` with `method=developer-id`.
- Release archive/export/signing now default to `build/package/release`; set `WORK_ROOT` if you need a different location.
- Default signing mode starts as `Automatic`, but the script will promote itself to `Manual` when it finds a matching `Developer ID` provisioning profile for the bundle id.
- Set `SIGNING_STYLE=Manual` only when you explicitly need to pair a named provisioning profile with the bundle id.
- Set `AUTO_DETECT_PROFILE=0` if you want to disable profile auto-resolution and keep Xcode's automatic signing behavior.
- The local packager keeps the ad-hoc signed `.app` in `build/package/local/export/`.
- When notarization succeeds, it staples the ticket and regenerates the zip as `*-macOS-notarized.zip`.
- When notarization is skipped, the output stays `*-macOS-signed.zip`.
- Set `KEEP_WORK_ROOT=1` if you want to inspect release intermediates after the script finishes.
