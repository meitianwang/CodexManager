# Desktop Mainline Migration Acceptance Audit

Date: 2026-06-01

This audit tracks the evidence for the desktop-mainline migration. The user has now approved removing the native Swift macOS app and using Electron as the macOS and Windows desktop release target.

## Status Summary

| Area | Status | Current evidence | Remaining gap |
| --- | --- | --- | --- |
| Migration design | Proven | `docs/superpowers/specs/2026-06-01-desktop-mainline-migration-design.md` exists and declares Electron as the desktop mainline with Swift retained during migration. | None for the design criterion. |
| Electron app location | Proven | `git ls-files apps/windows` returns 0 tracked files, `apps/windows` is absent from the working tree, tracked Electron files live under `apps/desktop`, and packaging contracts now assert the current app root is `apps/desktop`. | None for the location criterion. |
| Windows functionality after structural migration | Contract-covered for this macOS-machine phase | Electron typecheck, tests, build, Windows packaging script path updates, Windows adapter tests, and the `.github/workflows/windows-desktop.yml` workflow definition are present. Packaging contracts assert the workflow and release docs use desktop-mainline naming, the Windows packaging wrapper runs from `apps/desktop`, both package and make paths invoke Electron Forge with `--platform win32`, and the wrapper no longer relies on the generic host-platform `pnpm run package`, old `windows-app.yml`, or `apps/windows` paths. The user has clarified that Windows runner evidence is not important for the current macOS-machine phase. | Real packaged Windows smoke is deferred to a later Windows release pass before claiming installed-app workflow completion. |
| Electron macOS core workflows | Partially proven | `pnpm run smoke:macos-package` passes in smoke mode with account import/export, smoke OAuth, account switch, smart switch, proxy start/stop and routes, settings persistence, tray actions, and smoke-recorded Codex/editor/startup side effects. The package-smoke wrapper now independently validates `smoke-result.json` plus Accounts/Proxy/Settings screenshot artifacts before reporting success. `pnpm run verify:macos-real-data` passes against local account/settings/auth data without side effects. `pnpm run verify:macos-isolated-real-data` copies local data into a temp root and verifies account list, account transfer export/import, account switch, auth projection write, and settings persistence against that isolated copy. `pnpm run verify:macos-real-side-effects` now provides a default-dry-run executable verifier for the remaining real side-effect checks, with approved settings-write and OAuth account-import paths creating temporary 0600 backups before changing real settings or the account store. | Real OAuth browser login, real Codex launch, real editor restart, real login-item behavior, and real settings writes still require explicit approval before running. |
| Platform adapter isolation | Proven with caveat | Platform-sensitive filesystem, launch-at-startup, Codex launch, editor restart, tray, lifecycle, smoke defaults, source device IDs, request headers, and window icon choices live behind `apps/desktop/src/main/platform`. Shared services receive platform-owned values through the app context. Linux now has an explicit unsupported placeholder instead of falling through to Windows behavior. Desktop contracts now scan production `src/main` and `src/shared` files outside `platform` for platform-specific integration strings. | `platform/command-runner.ts` remains a shared low-level helper with Windows path support by design; Linux release hardening is deferred. |
| TypeScript as forward source of truth | Proven for shared desktop contracts | `apps/desktop/tests/desktop-contracts.test.ts` defines desktop behavior contracts for proxy models, endpoints, locales, and editor restart targets. Electron tests no longer read Swift source or Swift localization files as the source of truth. | Future shared behavior should add TypeScript desktop contracts directly instead of reviving Swift-source parity tests. |
| Swift macOS policy | Removed by user decision | The Swift package, Xcode project, Swift sources/tests, XcodeGen project config, and legacy Swift packaging scripts have been removed. | None for the removal criterion. |
| Documentation no longer treats Electron as only a Windows port | Proven with historical-context exception | Current release docs describe `apps/desktop` as the Electron desktop mainline. Remaining `apps/windows` references are in historical migration context, superseded Windows docs, or tests asserting the old renderer title is absent. | None for current-state documentation. |
| macOS-only feature classification | Closed | `docs/release-desktop.md` classifies CloudKit, WidgetKit, and Swift menu bar behavior as removed Swift-only capabilities outside the Electron release. | Cross-platform replacements require later product decisions. |
| macOS packaging and CI smoke | Locally proven, remote pending | `apps/desktop/assets/icon.icns`, `pnpm run verify:package-assets`, `pnpm run package:macos`, local `pnpm run smoke:macos-package`, packaged icon verification, and `.github/workflows/macos-desktop.yml` are present. Packaging contracts assert the macOS workflow uses desktop-mainline naming, Electron Forge Squirrel packaging remains Windows-only, and Electron Forge ZIP packaging is limited to `darwin` while Linux remains unsupported. `pnpm run collect:macos-ci-evidence` now provides a read-only remote evidence collector. | The new macOS GitHub Actions workflow has not yet been observed running remotely; current remote evidence is pending because the workflow is not on the remote default branch. macOS signing/notarization is out of scope until real side effects are verified. |

## macOS-Machine Phase Closure Decision

This phase should not be treated as rebuilding a macOS Electron app from scratch. The existing Electron code has been moved from a Windows-port shape into the `apps/desktop` desktop mainline, with platform-specific behavior isolated behind adapters and macOS support added where the existing workflow needs platform services.

Decision for this Goal phase: the Mac-machine implementation and automated/local-smoke phase is closed. The remaining items below are approval-gated or remote-evidence gates, not default implementation work for the current local Mac turn.

For the current Mac machine phase, the high-value work is already in place:

- The Electron app root is `apps/desktop`, and `apps/windows` is no longer the current app location.
- Windows assumptions for paths, Codex launch, editor restart, launch-at-startup, request headers, source device IDs, window icons, tray/lifecycle behavior, and smoke defaults are behind platform modules.
- A macOS adapter exists for the Electron app, and local verification has proven read-only real-data parsing plus isolated account/settings/auth workflows on this Mac.
- A packaged macOS smoke run has already proven the Electron app can execute the core UI/workflow surface against isolated data.
- The native Swift macOS app has been removed; Electron remains the desktop mainline.

The remaining gaps are approval-gated or intentionally deferred rather than implementation blockers for this Mac-machine migration phase:

- Real OAuth browser login, real Codex launch, real editor restart, login-item behavior, and real settings writes require explicit operator approval because they touch the user's local system state.
- Remote macOS CI evidence requires the local workflow to be committed/pushed before GitHub can run it.
- Windows installed-app smoke remains a later Windows release pass, per the user's clarification.
- The Swift app policy is now decided: Electron is the release target and Swift has been removed.

Stopping point for this phase: stop adding verifier hardening now, keep the current implementation and evidence, and decide separately whether to run targeted real macOS side-effect checks. The overall Goal remains active because the approval-gated and remote-evidence gates have not been completed.

## Recent Validation Evidence

Current validation after Swift removal:

- `pnpm exec vitest run tests/packaging-contracts.test.ts`: passed with 1 file and 15 tests, including the removed Swift app entrypoint guard.
- `pnpm run typecheck`: passed.
- `pnpm test`: passed with 16 files and 191 tests.
- `git diff --check`: passed.
- A residual file scan found no `.swift`, `Package.swift`, `.xcodeproj`, `.xcworkspace`, or `project.yml` files outside ignored dependency and Git directories.

Earlier closure validation after the macOS-machine scope correction, before Swift removal:

- Focused desktop/platform/packaging contracts: `pnpm exec vitest run tests/desktop-contracts.test.ts tests/platform-services.test.ts tests/packaging-contracts.test.ts` passed with 3 files and 44 tests.
- `swift test --quiet`: passed with 94 XCTest tests and 4 Swift Testing tests.
- `pnpm run verify:macos-real-data`: passed on this Mac with 4 accounts, parsed settings/auth, Codex CLI plus `/Applications/Codex.app`, 2 editor targets, and no writes, launches, OAuth, editor restarts, or login-item changes.
- `pnpm run verify:macos-real-side-effects`: passed in default dry-run mode and performed no writes, launches, OAuth browser flow, editor restarts, or login-item changes.
- `git diff --check`: passed.

Earlier local validation captured during active Goal turns before Swift removal:

- `pnpm run verify:package-assets`: passed.
- `pnpm run verify:macos-real-data`: passed on this Mac; local account store had 4 accounts, settings/auth parsed, Codex CLI and `/Applications/Codex.app` were detected, 2 editor targets were detected, and the verifier reported no writes, launches, OAuth, editor restarts, or login-item changes.
- `pnpm run verify:macos-isolated-real-data`: passed on this Mac; copied local account/settings/auth data into a temp root, verified account listing, transfer export/import, account switch, isolated auth projection write, settings toggle persistence/restoration, and removed the temp copy by default.
- `pnpm run smoke:macos-package`: passed on this Mac against `out/CodexManager-darwin-arm64/CodexManager.app`; the wrapper independently validated `smoke-result.json`, 5-account export evidence, package import evidence, smoke OAuth evidence, persistence files, 7 successful proxy route statuses, proxy auth rejection statuses, tray action sequence, smoke-recorded Codex/editor/startup side effects, and Accounts/Proxy/Settings screenshots at 1920x1008.
- `pnpm run plan:macos-real-side-effects`: dry-run plan passed; documented explicit approval gates for real OAuth, Codex launch, editor restart, login-item, and settings-write checks without performing them.
- `pnpm run verify:macos-real-side-effects`: default dry-run verifier passed with `approval-required`; it performed no writes, launches, OAuth browser flow, editor restarts, or login-item changes.
- `pnpm run collect:macos-ci-evidence`: passed as a read-only collector with `status: pending`; `gh` is available and authenticated, but `macos-desktop.yml` is not yet found on the remote default branch.
- `pnpm run build`: passed after adding the explicit Linux unsupported platform placeholder.
- Focused platform contracts passed with 1 file and 25 tests, including macOS adapter selection, Windows adapter selection, explicit Linux unsupported behavior, and unknown-platform rejection.
- Focused desktop contracts passed with 1 file and 5 tests, including a production-source scan that keeps platform-specific integration strings behind `src/main/platform`.
- Focused packaging contracts passed with 1 file and 14 tests, including the app-root contract that keeps Electron under `apps/desktop`, rejects the old `apps/windows` current path, verifies the Windows packaging wrapper and release doc use `apps/desktop` with explicit `--platform win32`, verifies `macos-desktop.yml` and `windows-desktop.yml` desktop-mainline workflow naming, keeps Squirrel packaging Windows-only, keeps Linux out of Electron release package targets while it remains unsupported, and preserves independent packaged-smoke artifact validation in the wrapper.
- Focused desktop/platform/packaging contracts passed with 3 files and 44 tests.
- `pnpm run typecheck`: passed.
- `pnpm test`: passed with 16 files and 187 tests.
- `swift test --quiet`: passed with 94 XCTest tests and 4 Swift Testing tests.
- `git diff --check`: passed after each recent structural turn.

## Completion Blockers

The Goal should not be marked complete yet because current evidence is still missing or intentionally smoke-only for these items:

- Real macOS OAuth browser login.
- Real macOS Codex app or CLI launch.
- Real macOS editor restart for installed editor targets.
- Real macOS launch-at-startup/login-item behavior.
- Real macOS settings writes against the user's app data.
- Remote GitHub Actions run evidence for the new macOS desktop workflow.

## Next Step

Stop broad verifier hardening. The current Mac-machine implementation and automated/local-smoke phase is closed. Next work should be Electron macOS/Windows release packaging and remote CI evidence after commit/push.
