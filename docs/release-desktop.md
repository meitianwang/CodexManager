# CodexManager Desktop Release Verification

This document tracks the Electron desktop release path for macOS and Windows. The native Swift macOS app has been removed and is no longer a release target.

## Current Release Boundary

- Electron under `apps/desktop` is the desktop mainline and release target.
- macOS packaging uses Electron Forge from `apps/desktop`.
- Windows packaging remains the current Windows release path; see `docs/release-windows.md`.
- The native Swift macOS app and its legacy packaging scripts have been removed from the repository.
- Linux hardening remains deferred. The desktop platform selector keeps Linux explicit as unsupported instead of routing Linux through the Windows adapter.

## macOS-Only Feature Boundary

The Electron desktop release intentionally does not carry these former Swift-only macOS integrations:

| Feature | Classification during migration | Release implication |
| --- | --- | --- |
| CloudKit account sync | Removed Swift-only capability | Not part of the Electron desktop release. A cross-platform replacement needs a later approved design. |
| CloudKit current selection sync and push notifications | Removed Swift-only capability | Not part of the Electron desktop release. |
| WidgetKit account widgets and app group snapshots | Removed Swift-only capability | Not part of the Electron desktop release unless the product scope changes. |
| Swift MenuBarExtra polish and Dockless accessory behavior | Replaced by Electron tray behavior | Pixel-identical native menu bar behavior is not required for the desktop release. |
| macOS paths, launch at startup, Codex launch, editor restart, and clipboard utilities | Retained as Electron desktop workflows | Implemented in the Electron macOS adapter. |

The removed Swift app no longer blocks Electron desktop release decisions.

## macOS Electron Checks

Run these from `apps/desktop` on macOS:

```sh
pnpm run verify:package-assets
pnpm run verify:macos-real-data
pnpm run verify:macos-isolated-real-data
pnpm run smoke:macos-package
pnpm run plan:macos-real-side-effects
pnpm run verify:macos-real-side-effects
pnpm run collect:macos-ci-evidence
```

`verify:package-assets` checks that the shared source icon, Windows `.ico`, and macOS `.icns` package assets exist and match the Electron Forge package configuration. The package and make scripts run this check before invoking Electron Forge.

`verify:macos-real-data` is read-only. It builds the Electron main process and verifies that the compiled desktop parsers can read the local CodexManager account/settings stores and `~/.codex/auth.json` without printing secrets or writing data.

`verify:macos-isolated-real-data` copies the local CodexManager account/settings stores and Codex auth into a temporary isolated root, then exercises the TypeScript account list, account transfer export/import, account switch, auth projection write, and settings persistence paths against that copy. It removes the temporary root by default and does not launch Codex, start OAuth, restart editors, change login items, or write the user's real app data.

`smoke:macos-package` builds the Electron app, packages `CodexManager.app` with Electron Forge for the current macOS architecture, then launches the packaged app in smoke mode. The smoke run uses an isolated temporary root for app data, Codex auth/config files, Electron `userData`, smoke screenshots, and the JSON result.

The smoke wrapper fails the command if the packaged app exits unsuccessfully, if `smoke-result.json` is missing or incomplete, or if the Accounts, Proxy, and Settings screenshot artifacts are missing or empty. It independently validates the core workflow evidence written by the app before reporting success.

The packaged smoke covers:

- renderer preload bridge and first paint
- Accounts, Proxy, and Settings UI fingerprints
- account switch, current auth write, current auth import, auth-file import, package import/export, OAuth flow through the smoke OAuth service, and smart switch
- proxy start/stop, health, auth rejection, and supported proxy routes through the smoke upstream client
- settings persistence in the isolated smoke root
- tray menu actions through the smoke tray adapter
- Codex launch, editor restart, and launch-at-startup through smoke side-effect recorders

The packaged smoke intentionally does not prove real user side effects. Before cutting a stable macOS release, verify these with an operator present:

- real OAuth browser login
- real Codex app or CLI launch
- real editor restart for installed editor targets
- real launch-at-startup behavior
- real settings writes against the user's app data

`plan:macos-real-side-effects` is a dry-run planning command for those manual checks. It documents the approval gate, the real side effects each check would perform, and the evidence to capture. It never starts OAuth, launches Codex, restarts editors, changes login items, or writes settings.

`verify:macos-real-side-effects` is the executable verifier for those same manual checks. By default it is also dry-run and reports `approval-required`. It refuses to execute real side effects unless all of these are true:

- `CODEX_MANAGER_ALLOW_REAL_MACOS_SIDE_EFFECTS=1` is set
- `--execute` is passed
- one or more explicit `--check` values are passed

Supported checks are `settings-write`, `oauth-browser-login`, `codex-launch`, `editor-restart`, and `login-item`. Use targeted runs, for example:

```sh
CODEX_MANAGER_ALLOW_REAL_MACOS_SIDE_EFFECTS=1 pnpm run verify:macos-real-side-effects -- --execute --check settings-write
CODEX_MANAGER_ALLOW_REAL_MACOS_SIDE_EFFECTS=1 pnpm run verify:macos-real-side-effects -- --execute --check codex-launch --workspace /path/to/workspace
CODEX_MANAGER_ALLOW_REAL_MACOS_SIDE_EFFECTS=1 pnpm run verify:macos-real-side-effects -- --execute --check editor-restart --editor vscode
```

Do not run the executable verifier without an operator present. `settings-write` creates a temporary 0600 backup before changing settings, reports the backup path, and restores the original settings file bytes after its toggle check. Treat that backup as local settings data because it can include the proxy API key, and remove it after evidence is captured if it is no longer needed. The OAuth check creates a temporary 0600 account-store backup before importing the OAuth account and reports the backup path; treat that backup as sensitive because account entries include auth material. Use `--restore-after-oauth` if the imported account should be removed from the account store after evidence is captured.

## macOS Smoke Artifacts

By default, `smoke:macos-package` leaves artifacts in the system temporary directory, including:

- `smoke-result.json`
- `screens/accounts.png`
- `screens/proxy.png`
- `screens/settings.png`
- isolated smoke app data under `root/`

To choose the artifact directory:

```sh
CODEX_MANAGER_ELECTRON_PACKAGE_SMOKE_ARTIFACT_DIR=/tmp/codexmanager-macos-package-smoke pnpm run smoke:macos-package
```

## macOS CI

The `.github/workflows/macos-desktop.yml` workflow runs on pull requests and `main` pushes that touch the desktop app or desktop release documentation. It can also be started manually with `workflow_dispatch`.

The workflow runs:

- `pnpm run verify:package-assets`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run smoke:macos-package`
- packaged app icon verification for `CFBundleIconFile=electron.icns`

It uploads:

- `CodexManager-macOS-Smoke`, containing `smoke-result.json`, smoke screenshots, and the isolated smoke root
- `CodexManager-macOS-App`, containing the unsigned/unnotarized packaged app bundle used by the smoke test

`collect:macos-ci-evidence` is a read-only evidence collector for this workflow. It uses `gh` to check whether the workflow exists on the remote default branch and whether any successful `macos-desktop.yml` runs are available. It does not dispatch workflows, mutate the remote, or download artifacts. A `pending` result means the workflow has not yet produced observable remote evidence. Use `--offline` only for local contract checks that must not contact GitHub.

## Minimum Evidence Before macOS Release Readiness

- `pnpm run verify:package-assets`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run build`
- `pnpm run verify:macos-real-data`
- `pnpm run verify:macos-isolated-real-data`
- `pnpm run smoke:macos-package`
- `pnpm run plan:macos-real-side-effects`
- `pnpm run verify:macos-real-side-effects` in default dry-run mode
- `pnpm run collect:macos-ci-evidence` with a successful remote workflow run once `.github/workflows/macos-desktop.yml` is on the remote branch being verified
- manual real side-effect verification for OAuth, Codex launch, editor restart, login item behavior, and settings writes

After these are complete, the Electron macOS app is the macOS release candidate. Signing and notarization evidence should be captured separately for the final distributed artifact.
