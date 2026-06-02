# CodexManager Desktop Mainline Migration Design

Date: 2026-06-01

## Decision

CodexManager will move from a macOS-native-first product with a separate Windows Electron port to an Electron desktop mainline with explicit platform adapters.

The current SwiftUI/AppKit macOS app remains available during the migration, but it stops being the long-term behavior source of truth for shared desktop workflows. The Electron app becomes the forward implementation for cross-platform desktop behavior.

## Context

CodexManager began as a native macOS app. That was a reasonable starting point because the first product needed macOS integration: menu bar UI, CloudKit sync, WidgetKit snapshots, launch-at-login, `.app` discovery, and native release packaging.

The product direction now requires desktop cross-platform support. The repository already contains an Electron app under `apps/windows`, but it is implemented and documented as a Windows port. It mirrors macOS behavior through parity tests and design notes instead of acting as the shared desktop mainline.

That creates long-term duplication: Swift and TypeScript each implement account behavior, auth parsing, usage refresh, proxy translation, settings, localization, and UI state. Continuing this approach means every shared feature must be built twice and kept aligned with parity checks.

## Goals

- Make Electron the shared desktop application line for macOS and Windows, with Linux left structurally possible.
- Keep core business behavior in TypeScript for forward development.
- Preserve the existing Swift macOS app until Electron macOS can cover core workflows.
- Keep Windows behavior stable while renaming and generalizing the Electron app.
- Isolate operating-system behavior behind platform adapters.
- Keep persisted account/settings/auth data compatible unless a later approved migration says otherwise.

## Non-Goals

- Do not remove the Swift macOS app in the first migration phases.
- Do not rebuild CloudKit sync in Electron as part of this migration.
- Do not rebuild WidgetKit widgets in Electron as part of this migration.
- Do not add a backend sync service.
- Do not harden Linux packaging until macOS and Windows are stable.
- Do not change account/settings/auth JSON formats without a separate approved migration.

## Target Architecture

```text
apps/desktop
  src/main
    app-context.ts
    platform
      index.ts
      macos
      windows
      linux
    services
    repositories
    proxy
    ipc

  src/preload
  src/renderer
  src/shared
```

Electron main owns privileged work: filesystem access, OAuth callback server, local proxy, process launching, editor restart, startup registration, tray integration, and IPC.

React renderer owns UI state and page presentation. It communicates through the typed preload bridge and never receives direct filesystem or process access.

Shared TypeScript modules own stable domain behavior: account identity, account ranking, usage window selection, transfer package merge, auth parsing, settings defaults, proxy route definitions, and protocol translation.

## Platform Adapter Boundary

The app should depend on a single platform object instead of importing Windows or macOS details inside services.

```ts
interface DesktopPlatform {
  readonly id: "macos" | "windows" | "linux";
  readonly sourceDeviceID: string;
  paths(): FileSystemPaths;
  launchAtStartupService(): LaunchAtStartupServiceLike;
  codexLauncher(): CodexLauncherLike;
  editorApps(): EditorAppServiceLike;
  createTrayAdapter(): TrayAdapter;
}
```

Initial adapters:

- `platform/windows`: moves current `%APPDATA%`, `%USERPROFILE%`, Squirrel startup, `taskkill`, `tasklist`, and Windows editor detection code behind the boundary.
- `platform/macos`: adds `~/Library/Application Support/CodexManager`, `~/.codex`, `open -na`, `pkill`/`pgrep`, macOS editor detection, and basic Electron tray behavior.
- `platform/linux`: starts as explicit unsupported placeholders for platform services not yet implemented, so Linux is not silently routed through Windows behavior and is not wired as a release target until requested.

## Migration Phases

### Phase 1: Design Contract

Create the migration design and goal contract. No business code changes.

Exit criteria:

- Goal workflow files exist.
- This design exists.
- Scope, stop conditions, and validation plan are explicit.

### Phase 2: Rename Electron App

Rename `apps/windows` to `apps/desktop`.

Update:

- package name and descriptions;
- scripts;
- docs and release notes;
- GitHub Actions paths;
- packaging scripts;
- ignored generated artifacts;
- test names that describe the app as Windows-only when they now describe desktop behavior.

Windows-specific packaging can remain Windows-specific under the desktop app.

Exit criteria:

- `apps/desktop` builds and tests.
- Windows packaging script points at `apps/desktop`.
- Existing Windows behavior remains unchanged.

### Phase 3: Extract Windows Platform Adapter

Move current Windows-specific services behind adapter interfaces without changing behavior.

Targets:

- filesystem paths;
- launch at startup;
- Codex launch;
- editor detection/restart;
- tray integration;
- command runner assumptions;
- smoke-only side effect adapters.

Exit criteria:

- Main app context is adapter-driven.
- Windows tests still pass.
- No service outside `platform/windows` directly depends on `%APPDATA%`, `%USERPROFILE%`, `win32`, `taskkill`, or Squirrel startup details unless it is a packaging script.

### Phase 4: Add macOS Electron Adapter

Implement enough macOS platform support for Electron to run the core app.

Core workflows:

- load accounts;
- import current auth;
- import/export account package;
- OAuth login;
- switch account;
- smart switch;
- refresh usage;
- start/stop proxy;
- persist settings;
- launch Codex;
- restart supported editors where installed.

Exit criteria:

- Electron macOS dev/build runs.
- Electron macOS uses existing CodexManager/Codex local paths.
- Core workflows pass local smoke verification.

### Phase 5: Contract Tests

Convert Windows/macOS parity checks into desktop behavior contract tests.

The Swift app can remain a reference during migration, but tests should increasingly assert TypeScript desktop behavior directly instead of treating Swift source as the permanent truth.

Exit criteria:

- Shared behavior tests are named and structured around desktop contracts.
- Swift tests remain as regression coverage.
- New features can target TypeScript first without adding equivalent Swift behavior unless explicitly needed.

### Phase 6: Desktop Packaging

Add desktop release documentation and package verification.

Initial release targets:

- Windows: existing Squirrel flow, moved under desktop docs.
- macOS: Electron package smoke first; signing/notarization later.
- Linux: deferred.

Exit criteria:

- `docs/release-desktop.md` documents supported targets and gaps.
- CI verifies Windows Electron and macOS Electron builds where possible.
- Packaged smoke evidence is captured for release candidates.

### Phase 7: Swift App Policy

After Electron macOS covers core workflows, choose one of three paths:

- maintenance-only Swift app;
- Swift helper for macOS-only integration;
- deprecation and later removal.

This decision requires explicit user approval.

## Data Compatibility

The migration should preserve:

- `accounts.json`;
- `settings.json`;
- account transfer package format;
- active Codex auth at `~/.codex/auth.json` on macOS and `%USERPROFILE%\.codex\auth.json` on Windows.

Any schema change must be explicit, versioned, tested, and approved before implementation.

## macOS-Only Features

CloudKit sync and WidgetKit snapshots are not blockers for Electron macOS core workflow parity. They are still real Swift app capabilities, so the migration classifies them explicitly instead of treating their absence from Electron as an implicit removal.

| Feature | Current Swift owner | Migration classification | Electron desktop decision |
| --- | --- | --- | --- |
| Account store CloudKit sync | `CloudKitAccountsSyncService` | Retained in Swift only during migration | Deferred for Electron. Do not reimplement with CloudKit or a backend service without a separate approved design. |
| Current account selection CloudKit sync | `CloudKitCurrentAccountSelectionSyncService` | Retained in Swift only during migration | Deferred for Electron. Local account switching remains part of the Electron core workflow. Cross-device selection sync needs a later product decision. |
| CloudKit push notifications | `CodexManagerAppDelegate`, CloudKit sync services | Retained in Swift only during migration | Deferred for Electron. Packaged Electron release readiness does not depend on CloudKit push. |
| WidgetKit account snapshot widget | `AccountsWidgetSnapshotWriter`, `Sources/CodexManagerWidgets` | Retained in Swift only during migration | Deferred for Electron. No cross-platform widget promise is added in this migration. |
| App group widget snapshot storage | `AccountsWidgetSnapshotStore` | Retained in Swift only during migration | Deferred for Electron unless the WidgetKit decision changes later. |
| Menu bar popover and Dockless accessory behavior | `MenuBarExtra`, `NSApplication.setActivationPolicy(.accessory)` | Retained in Swift while Electron reaches parity | Replaced by Electron tray behavior for the desktop mainline. Pixel-identical native menu bar polish is not required for core parity. |
| macOS Application Support and `~/.codex` paths | `FileSystemPaths` | Retained as data compatibility requirement | Reimplemented in `platform/macos` and verified by read-only real-data checks. |
| Launch at startup | `LaunchAtStartupService` using `SMAppService` | Retained as a desktop setting | Reimplemented through the Electron platform adapter. Real login-item behavior still needs explicit manual verification. |
| Codex app / CLI launch | `CodexCLIService` | Retained as a core workflow | Reimplemented in `platform/macos`. Smoke records the side effect; real launch still needs explicit manual verification. |
| Editor detection and restart | `EditorAppService` | Retained as a core workflow where supported | Reimplemented in `platform/macos`. Smoke records the side effect; real editor restart still needs explicit manual verification. |
| Native clipboard copy affordances | `PlatformClipboard`, AppKit pasteboard usage in proxy UI | Retained as user-facing utility | Replaced by Electron renderer/main clipboard behavior where needed; not a separate macOS release blocker. |

No macOS-only feature is dropped by the current migration. Dropping CloudKit, WidgetKit, or the Swift app itself remains a stop condition that requires explicit user approval.

## Validation

Run during structural phases:

```bash
git status --short
swift test
cd apps/desktop && pnpm run typecheck
cd apps/desktop && pnpm test
cd apps/desktop && pnpm run build
```

Additional release checks:

- Windows packaged smoke on a Windows runner before a later Windows release pass; this is deferred for the current macOS-machine Goal phase.
- macOS Electron smoke once the macOS adapter exists.
- Manual verification for real OAuth, account switching, Codex launch, editor restart, and proxy routes before claiming platform release readiness.

## Risks

- The rename from `apps/windows` to `apps/desktop` can touch many scripts and docs. Keep it mechanical and validate before adapter work.
- Platform adapter extraction can accidentally change Windows behavior. Move code first, then refactor internals only after tests pass.
- Electron macOS may not match Swift macOS polish immediately. Core workflow parity is the first milestone; native polish is a later decision.
- CloudKit and WidgetKit are real product capabilities in the Swift app. Their cross-platform replacement or removal needs a separate decision.

## Success Criteria

- The Electron app is no longer documented or structured as only a Windows port.
- Windows functionality stays intact through adapter and packaging contracts in this macOS-machine phase; installed Windows smoke remains a later Windows release gate.
- Electron macOS can complete the core product workflows.
- Shared business behavior has a TypeScript forward source of truth.
- Platform-specific code is isolated and testable.
- The Swift macOS app has a documented maintenance/deprecation policy after Electron macOS core parity is proven.
