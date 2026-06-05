# Codex.app Provider Integration Implementation Plan

Date: 2026-06-04

Spec: `docs/superpowers/specs/2026-06-04-codex-app-provider-integration-design.md`

## Operating Rules

- Keep Codex provider writes in Electron main.
- Keep renderer access behind typed preload IPC.
- Never persist the CodexManager proxy API key in integration metadata.
- Use atomic private writes for config, backup, and manifest files.
- Preserve unrelated user `~/.codex/config.toml` content.
- Keep stdout/stderr buffers bounded when adding command execution.
- Do not touch the user's real Codex config in tests; use temp paths.

## Phase 1: Shared Contracts

Add shared integration result types:

- status state;
- status payload;
- restore mode;
- operation result warning fields.

Add IPC channel constants and schema entries for:

- status;
- configure;
- safe restore;
- snapshot restore.

## Phase 2: Main Service

Add `CodexAppIntegrationService`.

Responsibilities:

- read Codex config from `paths.codexConfigPath`;
- create backup and manifest under `paths.applicationSupportDirectory`;
- write the `codexmanager` provider block;
- restore safely from structured metadata;
- restore fully from backup snapshot;
- detect configured, drifted, restorable, and not-configured states;
- set GUI-visible proxy API key through a platform adapter.

## Phase 3: Platform Environment Adapter

Extend platform types with a small environment service.

Initial behavior:

- macOS runs `/bin/launchctl setenv CODEXMANAGER_PROXY_API_KEY <key>`;
- Windows and Linux return a warning/unsupported result instead of pretending GUI env was updated.

## Phase 4: IPC and App Context

Wire the service into `createDesktopAppContext`.

Expose preload methods:

- `codexApp.getStatus`;
- `codexApp.configure`;
- `codexApp.restoreSafe`;
- `codexApp.restoreSnapshot`.

Register IPC handlers and return typed status payloads.

## Phase 5: Renderer UI

Add a Codex.app integration section on the Proxy page.

Controls:

- Configure Codex.app;
- Safe restore;
- Full restore.

Display:

- integration state;
- config path;
- selected provider/model;
- warnings such as “restart Codex.app” or “proxy must be running”.

Do not display the full proxy API key.

## Phase 6: Validation

Run:

- focused service tests;
- IPC tests;
- proxy/runtime tests touched by model defaults;
- TypeScript typecheck.

Add or update an isolated Codex CLI smoke only if it can run without touching the user's real config.
