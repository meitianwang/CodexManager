# Codex.app Provider Integration Design

Date: 2026-06-04

## Decision

CodexManager will provide first-class Codex.app provider integration: one action enables the CodexManager proxy as Codex.app's active provider, and restore actions can either safely undo only CodexManager-managed changes or restore the full pre-configuration file snapshot.

The feature writes user-level Codex configuration at `~/.codex/config.toml` through the Electron main process. Renderer code must not perform direct filesystem writes or shell environment mutation.

## Context

The CodexManager proxy already exposes OpenAI-compatible endpoints behind a local API key. A real end-to-end test confirmed that Codex CLI can run a complete agent task through the proxy when configured as a custom Responses API provider.

Manual setup is still too fragile for product use:

- Codex provider configuration must live in the user-level `~/.codex/config.toml`; project-local `.codex/config.toml` files cannot safely own provider auth.
- macOS GUI apps do not reliably inherit shell-only environment variables.
- The CodexManager proxy uses a local `sk-local-*` key, while the proxy itself owns the ChatGPT account authentication upstream.
- Users need a reversible change, not a copy-paste snippet that leaves them to repair their Codex config manually.

Codex's current configuration documentation supports custom model providers with `model_provider`, `[model_providers.<id>]`, `base_url`, `wire_api`, and `env_key`. It also states that user-level config is the appropriate place for provider and auth settings.

## Goals

- Add a one-click Codex.app proxy-mode configuration action.
- Add a default safe restore action that preserves user edits made after CodexManager integration.
- Add a full snapshot restore action for exact rollback when the user wants it.
- Configure Codex to use the CodexManager proxy through the Responses API.
- Set the local proxy API key where Codex.app can read it.
- Report integration status in the UI: not configured, configured, drifted, or restorable.
- Keep writes atomic and private.
- Cover config mutation and restore behavior with focused tests.

## Non-Goals

- Do not change Codex.app source code.
- Do not depend on project-local `.codex/config.toml` for provider setup.
- Do not implement a complete TOML parser unless the controlled block approach proves insufficient.
- Do not silently terminate or restart Codex.app.
- Do not remove support for generic cURL or environment-variable proxy instructions.
- Do not make CodexManager responsible for arbitrary third-party provider configuration.

## Target Configuration

CodexManager manages a provider with the fixed id `codexmanager`:

```toml
model = "gpt-5.5"
model_provider = "codexmanager"

[model_providers.codexmanager]
name = "CodexManager Proxy"
base_url = "http://127.0.0.1:18317/v1"
wire_api = "responses"
env_key = "CODEXMANAGER_PROXY_API_KEY"
requires_openai_auth = false
request_max_retries = 1
stream_max_retries = 1
stream_idle_timeout_ms = 300000
```

The model default should be `gpt-5.5`, because local preflight against ChatGPT account-backed Codex responses currently accepts it for the managed Codex.app provider.

The provider must use `env_key` instead of `requires_openai_auth = true`, because Codex.app should authenticate to the local proxy with the CodexManager API key. CodexManager then authenticates upstream using the selected stored ChatGPT account.

Codex.app defaults thread history listing to the active provider. Because proxy mode must force root-level `model_provider = "codexmanager"`, CodexManager must also make existing OpenAI-backed local history visible under the managed provider. It does this by updating only the first `session_meta` line in local rollout JSONL files and recording the previous provider for safe restore.

## Architecture

Add a main-process service:

```ts
class CodexAppIntegrationService {
  status(): Promise<CodexAppIntegrationStatus>;
  configure(options?: CodexAppConfigureOptions): Promise<CodexAppIntegrationStatus>;
  restoreSafe(): Promise<CodexAppIntegrationStatus>;
  restoreSnapshot(): Promise<CodexAppIntegrationStatus>;
}
```

The service depends on:

- `FileSystemPaths` for `codexConfigPath` and `applicationSupportDirectory`;
- `ProxyRuntimeService` for current proxy port, generated API key, and optional proxy start behavior;
- `SettingsCoordinator` only when persisted proxy settings must be read without changing runtime state;
- a small platform environment adapter for GUI-visible environment variables;
- existing atomic file write helpers.

The app context wires this service beside `ProxyRuntimeService`. IPC exposes status, configure, safe restore, and snapshot restore. The preload bridge exposes only those high-level methods.

Renderer integration lives on the Proxy page in a dedicated Codex.app section. It shows status and actions, but it never builds or writes the final config file.

## Persistence

CodexManager stores integration metadata under Application Support, for example:

```text
~/Library/Application Support/CodexManager/codex-app-integration.json
~/Library/Application Support/CodexManager/codex-config-backups/<timestamp>.toml
```

The metadata records:

- backup path;
- original full config hash;
- configured config hash;
- previous root `model` value when present;
- previous root `model_provider` value when present;
- per-history-file provider patches for `~/.codex/sessions` and `~/.codex/archived_sessions`;
- proxy URL and environment variable name used for the integration;
- timestamp of the latest configure action.

It must not store the proxy API key. The key already lives in CodexManager settings and should only be written into the GUI-visible environment.

## Config Mutation Strategy

Use conservative text transforms with a managed provider block:

1. Read existing config if it exists; otherwise treat it as empty.
2. Save a full snapshot before the first configure action, and refresh the snapshot only when no active restore metadata exists.
3. Replace or insert root-level `model` and `model_provider` assignments.
4. Remove any existing `[model_providers.codexmanager]` table and its direct child tables.
5. Append a fresh CodexManager provider block.
6. Sync local rollout history metadata so existing OpenAI sessions are visible when Codex.app filters by `codexmanager`.
7. Write atomically with private permissions.

Safe restore:

1. Read current config.
2. Remove the CodexManager provider block.
3. Restore previous root `model` and `model_provider` values from metadata.
4. If a previous root key did not exist, remove the key only when it still has the CodexManager-managed value.
5. Restore any rollout history provider patches recorded in metadata.
6. Preserve unrelated lines and user edits made after configuration.
7. Clear active restore metadata after success, while keeping the backup file for manual inspection.

Full snapshot restore:

1. Read the backup file referenced by metadata.
2. Replace `~/.codex/config.toml` with the snapshot bytes.
3. Restore any rollout history provider patches recorded in metadata.
4. Clear active restore metadata after success.

Repeated configure must be idempotent: it updates the managed provider block and proxy URL/key environment, but does not create a new backup every time unless there is no active metadata.

## Environment Handling

On macOS, configuration should run:

```bash
launchctl setenv CODEXMANAGER_PROXY_API_KEY <proxyApiKey>
```

The command must be executed without passing large text through argv other than the bounded API key. The service should report a warning if the environment command fails while still leaving the file configuration result clear.

On Windows and Linux, the first implementation can return an explicit unsupported or manual-restart warning unless platform-specific GUI environment persistence is added in the same implementation plan.

## Status Model

`CodexAppIntegrationStatus` should include:

- `state`: `not_configured`, `configured`, `drifted`, or `restorable`;
- `configPath`;
- `proxyURL`;
- `model`;
- `providerId`;
- `hasBackup`;
- optional warning or error message.

Suggested meanings:

- `not_configured`: no CodexManager provider and no active restore metadata.
- `configured`: current config matches the expected provider block and root provider selection.
- `drifted`: metadata exists, but current config no longer matches the expected managed configuration.
- `restorable`: current config is not configured, but metadata and backup still allow restore.

## UI

Add a Codex.app section to the Proxy page near the usage examples.

Controls:

- Configure Codex.app
- Safe restore
- Full restore from backup

The section should show concise status text and avoid exposing the full API key. After configuration, show that Codex.app should be restarted for GUI environment changes to take effect. Do not force a restart.

The generic usage copy blocks remain available for other tools.

## Error Handling

- Missing `~/.codex` directory: create it before writing config.
- Unreadable config: surface the error and do not overwrite.
- Invalid or unexpected TOML structure: preserve full snapshot and use controlled text transforms only around root keys and the managed provider table.
- Missing proxy API key: generate one through existing proxy settings behavior before configuring.
- Proxy stopped: configuration can still be written using the saved proxy port and API key, but status should make clear that Codex.app calls require the proxy to be running.
- Environment update failure: report a warning with the config still marked written.

## Testing

Add service tests for:

- empty config configure;
- existing user config configure;
- existing non-CodexManager providers are preserved;
- repeated configure is idempotent;
- safe restore after no user edits;
- safe restore after unrelated user edits;
- full snapshot restore;
- drift detection;
- missing config file;
- environment command failure warning.

Add IPC tests for configure, status, safe restore, and full restore handlers.

Add renderer tests only if existing renderer test patterns support them cheaply. Otherwise keep UI changes simple and rely on typecheck plus a local browser smoke check.

End-to-end validation should use an isolated temp Codex config and a Codex CLI agent task through the CodexManager proxy, matching the real-agent test already proven manually.

## Acceptance Criteria

- A user can enable CodexManager proxy mode in Codex.app from CodexManager with one action.
- Existing OpenAI-backed Codex local history remains visible in Codex.app while proxy mode is active.
- A user can safely restore without losing unrelated post-configuration edits.
- A user can fully restore the exact pre-configuration file snapshot.
- The feature never exposes or logs the proxy API key in UI status or test failure summaries.
- Original user config is backed up before mutation.
- Writes are atomic and private.
- The configured Codex provider can run a complete Codex CLI agent turn through the CodexManager proxy.
