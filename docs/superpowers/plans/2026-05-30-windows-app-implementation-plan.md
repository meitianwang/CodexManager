# CodexManager Windows App Implementation Plan

Date: 2026-05-30

Spec: `docs/superpowers/specs/2026-05-30-windows-app-design.md`

Superseded by `docs/superpowers/specs/2026-06-01-desktop-mainline-migration-design.md` for ongoing desktop-mainline work. This document is retained as historical context for the original Windows port implementation.

Do not use the `apps/windows` paths below as current implementation guidance. The current Electron desktop mainline lives under `apps/desktop`, and new cross-platform work should follow the desktop-mainline migration design plus the platform adapter boundary.

## Operating Rules

- Keep the existing Swift macOS app working throughout the migration.
- Put the Windows app under `apps/windows`.
- Prefer typed TypeScript modules over ad hoc renderer logic.
- Keep privileged filesystem, process, OAuth callback, and proxy work in Electron main.
- Keep renderer access behind a typed preload bridge.
- Avoid unbounded stdout, stderr, HTTP request, and stream buffering.
- Do not pass large prompts or payloads as command-line arguments; use stdin, files, or HTTP bodies.
- Register process close/error handlers before starting async consumption loops.
- Do not copy macOS-only behavior into Windows as dead UI.

## Phase 1: Scaffold and Tooling

Create the Windows app skeleton.

Files and directories:

- `apps/windows/package.json`
- `apps/windows/tsconfig.json`
- `apps/windows/vite.config.ts`
- `apps/windows/vitest.config.ts`
- `apps/windows/electron.vite.config.ts` or equivalent build config
- `apps/windows/src/main`
- `apps/windows/src/preload`
- `apps/windows/src/renderer`
- `apps/windows/src/shared`
- `apps/windows/tests`

Required scripts:

- `dev`: run Electron app in development.
- `typecheck`: run TypeScript checks.
- `test`: run Vitest.
- `build`: compile main, preload, and renderer.
- `package`: produce an unpacked or packaged Windows artifact.

Acceptance:

- `npm install` or `pnpm install` works inside `apps/windows`.
- `npm run typecheck` passes.
- `npm test` passes with at least one smoke test.
- `npm run build` produces compiled app output.

## Phase 2: Shared Models and Persistence

Port the stable data contracts from Swift to TypeScript.

Modules:

- `src/shared/models/accounts.ts`
- `src/shared/models/settings.ts`
- `src/shared/models/auth.ts`
- `src/shared/models/usage.ts`
- `src/main/repositories/file-system-paths.ts`
- `src/main/repositories/accounts-store-repository.ts`
- `src/main/repositories/settings-repository.ts`
- `src/main/repositories/auth-repository.ts`
- `src/main/repositories/atomic-file-writer.ts`

Behavior:

- Preserve `AccountsStore`, `StoredAccount`, `CurrentAccountSelection`, `AppSettings`, and account transfer JSON shapes.
- Store app-owned data under `%APPDATA%\CodexManager`.
- Read/write Codex auth under `%USERPROFILE%\.codex`.
- Back up corrupt `accounts.json` before resetting, matching the macOS repository behavior.
- Generate proxy API keys with the existing `sk-local-` shape.

Tests:

- Decode legacy settings defaults.
- Save and reload accounts.
- Back up corrupt store.
- Normalize and write Codex auth JSON.
- Resolve Windows paths using injected environment variables.

## Phase 3: Account Domain Behavior

Port account behavior independent of UI and OS integration.

Modules:

- `src/shared/domain/account-identity.ts`
- `src/shared/domain/account-ranking.ts`
- `src/shared/domain/account-plan-resolver.ts`
- `src/shared/domain/usage-window-selector.ts`
- `src/shared/domain/accounts-transfer-merge.ts`
- `src/main/services/accounts-coordinator.ts`

Behavior:

- List accounts with current account projection.
- Import current auth.
- Import arbitrary auth files.
- Import/export account transfer packages.
- Delete accounts.
- Edit team alias.
- Switch current account by writing Codex auth.
- Smart switch and auto smart switch.
- Preserve principal/account matching semantics from Swift tests.

Tests:

- Account ranking parity.
- Current account matching parity.
- Account transfer merge parity.
- Smart switch selection.
- Switch writes the selected auth into a temp `.codex` directory.

## Phase 4: OAuth, Usage, and Workspace Metadata

Implement network services.

Modules:

- `src/main/services/oauth/openai-chatgpt-oauth-service.ts`
- `src/main/services/oauth/pkce.ts`
- `src/main/services/oauth/callback-server.ts`
- `src/main/services/usage-service.ts`
- `src/main/services/weekly-quota-warmup-service.ts`
- `src/main/services/workspace-metadata-service.ts`

Behavior:

- Keep PKCE + loopback callback OAuth flow.
- Open authorization URLs with `shell.openExternal`.
- Validate callback state.
- Exchange authorization code and refresh token.
- Coalesce concurrent refresh-token exchanges.
- Fetch usage and workspace metadata.
- Warm reset weekly quota accounts where the existing app supports it.

Tests:

- OAuth callback success.
- OAuth state mismatch.
- Token refresh coalescing and short cache.
- Usage parsing for primary and secondary windows.
- Workspace name enrichment fallback.

## Phase 5: Local Proxy

Implement the local API proxy as a main-process-owned Node module.

Modules:

- `src/main/proxy/proxy-server.ts`
- `src/main/proxy/proxy-coordinator.ts`
- `src/main/proxy/upstream-client.ts`
- `src/main/proxy/chat-to-codex-translator.ts`
- `src/main/proxy/anthropic-to-codex-translator.ts`
- `src/main/proxy/endpoint-request-coordinator.ts`

Routes:

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/responses/compact`
- `POST /v1/memories/trace_summarize`
- `POST /v1/alpha/search`
- `POST /v1/messages`

Behavior:

- Bind to loopback by default.
- Enforce API key auth for every non-health route.
- Support CORS and OPTIONS preflight.
- Preserve SSE streaming.
- Retry across eligible accounts.
- Refresh expired tokens and retry.
- Apply account, model, and auth cooldowns.
- Bound preflight and request buffering.

Tests:

- Health route.
- API key rejection.
- Chat translation.
- Responses pass-through.
- Anthropic translation.
- SSE error before output retries the next eligible account.
- Model route forwards Codex headers.

## Phase 6: Windows Platform Services

Implement OS-specific integration.

Modules:

- `src/main/platform/command-runner.ts`
- `src/main/platform/codex-cli-service.ts`
- `src/main/platform/editor-app-service.ts`
- `src/main/platform/launch-at-startup-service.ts`
- `src/main/platform/tray-service.ts`

Behavior:

- Resolve executables from PATH and known Windows install paths.
- Keep command output to a bounded tail buffer.
- Launch Codex desktop app when discoverable.
- Fall back to `codex app [workspace]`.
- Detect VS Code, VS Code Insiders, Cursor, Antigravity, Kiro, Trae, and Qoder.
- Restart selected editors by exact process name and executable path.
- Use Electron `app.setLoginItemSettings` for launch at startup.
- Add a tray menu with show, refresh, smart switch, start/stop proxy, and quit actions.

Tests:

- Command runner timeout and bounded output.
- PATH executable resolution.
- Editor detection from injected filesystem fixtures.
- Codex CLI fallback command construction.
- Launch-at-startup service calls Electron API wrapper.

## Phase 7: IPC Contract and React UI

Implement the renderer once the main-process contract is stable.

Modules:

- `src/shared/ipc/schema.ts`
- `src/preload/index.ts`
- `src/renderer/App.tsx`
- `src/renderer/pages/AccountsPage.tsx`
- `src/renderer/pages/ProxyPage.tsx`
- `src/renderer/pages/SettingsPage.tsx`
- `src/renderer/components`
- `src/renderer/i18n`

Behavior:

- Expose typed IPC methods with schema validation.
- Keep account, proxy, and settings page structure aligned with the macOS app.
- Do not expose macOS-only controls.
- Add Windows tray/window controls.
- Support all 11 language choices.
- Provide user-visible errors from main-process failures.

Tests:

- Renderer smoke test.
- Accounts page with mocked IPC.
- Proxy page start/stop and copied values.
- Settings persistence.
- Locale switching.

## Phase 8: Packaging and Docs

Add packaging configuration and Windows release documentation.

Files:

- `apps/windows/forge.config.ts` or equivalent Forge config.
- `apps/windows/assets`
- `scripts/package_windows.ps1`
- `docs/release-windows.md`

Behavior:

- Produce local unpacked app artifacts.
- Configure Squirrel.Windows installer.
- Document Windows build prerequisites.
- Document manual verification steps.

Acceptance:

- Local build works on the development OS for non-Windows-neutral steps.
- Windows packaging instructions are explicit about requiring Windows or compatible CI tooling.
- Windows manual verification checklist maps to the spec acceptance criteria.

## Continuous Verification

Run after each phase:

- Windows app `typecheck`, `test`, and `build` commands when available.
- Existing repository `swift test` when shared docs, behavior descriptions, or root project files are changed.
- `git status --short` before every commit.

Run before claiming goal completion:

- Automated Windows app unit and integration tests.
- Packaged Windows artifact verification.
- Manual Windows verification of UI parity, OAuth, switching, Codex launch, proxy routes, persistence, startup registration, and editor restart.
- Existing macOS `swift test`.

## Completion Boundary

This plan is complete only when the repository contains a runnable Windows app and all acceptance criteria from the design spec have current evidence. A scaffold, partial port, or passing unit tests alone do not satisfy the goal.
