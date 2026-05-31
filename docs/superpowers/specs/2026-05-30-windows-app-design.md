# CodexManager Windows App Design

Date: 2026-05-30

## Decision

Build a separate Windows desktop app with Electron + React + TypeScript. Keep the existing SwiftUI/AppKit macOS app unchanged, and treat it as the behavioral source of truth for feature parity.

The Windows app will live at `apps/windows`, with its own Electron main process, preload bridge, React renderer, tests, and packaging scripts.

## Goal

Deliver a Windows version of CodexManager with all non-macOS-specific functionality:

- Manage multiple Codex / ChatGPT accounts.
- Add accounts via ChatGPT OAuth.
- Import the current Codex auth file.
- Import and export CodexManager account transfer packages.
- Display 5-hour and weekly usage windows.
- Refresh usage manually and in the background.
- Smart switch to the account with the most available quota.
- Auto smart switch when the current account is exhausted.
- Write the selected account to the local Codex auth file.
- Optionally launch Codex after account switching.
- Optionally restart selected editors after account switching.
- Run the local HTTP proxy for OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages compatibility.
- Persist settings, proxy port, proxy API key, language, and switching behavior.
- Expose the same 11 language choices as the macOS app. Shared strings should reuse equivalent translations, and Windows-only user-visible strings must have entries for all 11 locales before release.

## Non-Goals

The first Windows version will not implement macOS-only features:

- CloudKit account sync and push notifications.
- macOS widgets.
- AppKit menu bar behavior, Dock hiding, and macOS notification delegate behavior.
- macOS signing, notarization, DMG, and ZIP release scripts.

The first Windows version also will not rewrite the macOS app. Cross-platform sharing is allowed only where it does not destabilize the current Swift app.

## Current Project Evidence

The current app is a native Swift app:

- Swift package entry: `Package.swift`.
- XcodeGen project: `project.yml`.
- macOS app entry: `Sources/CodexManager/CodexManagerApp.swift`.
- dependency wiring: `Sources/CodexManager/App/AppContainer.swift`.
- core account behavior: `Sources/CodexManager/Behavior/AccountsCoordinator.swift`.
- proxy behavior: `Sources/CodexManager/Behavior/ProxyCoordinator.swift`.
- local persistence: `Sources/CodexManager/Infrastructure/StoreFileRepository.swift`.
- platform capability flags: `Sources/CodexManager/Domain/PlatformCapabilities.swift`.

Known platform-bound areas:

- `CloudKitAccountsSyncService`, `CloudKitCurrentAccountSelectionSyncService`, and `CloudSyncAvailabilityService` depend on CloudKit.
- `LaunchAtStartupService` depends on `ServiceManagement`.
- `CodexCLIService` and `EditorAppService` use macOS process commands and `.app` bundle lookup.
- `ProxyHTTPServer` and `SimpleHTTPServer` use Apple's Network framework.
- UI code uses SwiftUI, AppKit, and WidgetKit.

## Architecture

The Windows app will use a small, explicit boundary between UI, domain behavior, and operating system integration.

```text
Electron main process
  platform services
  local HTTP proxy
  OAuth callback server
  filesystem repositories
  account and settings coordinators
        |
        | typed IPC
        v
React renderer
  accounts page
  proxy page
  settings page
  tray/window presentation
```

### Main Process

The Electron main process owns all privileged work:

- reading and writing `accounts.json`, `settings.json`, and Codex `auth.json`;
- opening the OAuth authorization URL in the system browser;
- running the localhost OAuth callback server;
- running the localhost proxy server;
- launching Codex;
- detecting and restarting installed editors;
- registering or unregistering startup launch behavior;
- exposing a typed IPC API to the renderer.

The renderer never receives raw filesystem access. It calls typed IPC methods and receives DTOs.

### Renderer

The renderer implements the Windows UI in React:

- `AccountsPage`: account cards, refresh, login, import/export, delete, smart switch, team alias editing.
- `ProxyPage`: start/stop proxy, port/API key controls, generated endpoint examples, model selection.
- `SettingsPage`: launch at startup, launch Codex after switch, auto smart switch, editor restart targets, language.

The UI should follow the existing app's information architecture instead of becoming a marketing page.

### Shared Behavior Port

Behavior will be ported from Swift into TypeScript modules with equivalent names and tests where useful:

- account identity matching;
- plan resolution;
- account ranking;
- usage window selection;
- auth JSON parsing and normalization;
- account transfer merge;
- OpenAI Chat to Codex translation;
- Anthropic Messages to Codex translation;
- proxy retry and cooldown policy.

The TypeScript port should preserve observable behavior, not line-by-line structure.

## Data Model and Paths

Windows will preserve the existing JSON shapes for app-owned data:

- `accounts.json` matches `AccountsStore`.
- `settings.json` matches `AppSettings`.
- account transfer packages match `AccountsTransferPackage`.

Windows app-owned files will live under:

```text
%APPDATA%\CodexManager\accounts.json
%APPDATA%\CodexManager\settings.json
```

The selected Codex account will be written to the Windows Codex CLI auth path:

```text
%USERPROFILE%\.codex\auth.json
%USERPROFILE%\.codex\config.toml
```

If Codex changes its Windows config location, `FileSystemPaths` in the Windows app must isolate that change behind one platform service.

## Platform Feature Mapping

| macOS feature | Windows behavior |
| --- | --- |
| SwiftUI window and menu bar app | Electron BrowserWindow plus Windows tray icon |
| AppKit pasteboard | Electron clipboard |
| ServiceManagement launch at login | Electron `app.setLoginItemSettings` startup registration |
| `/Applications/*.app` editor detection | `%LOCALAPPDATA%`, `%PROGRAMFILES%`, `%PROGRAMFILES(X86)%`, and PATH-aware editor detection |
| `open -na` editor restart | process termination plus executable relaunch |
| `pkill`/`pgrep` | Windows `tasklist`/`taskkill` process enumeration and termination through a bounded command runner |
| `NSWorkspace.open` OAuth URL | Electron shell openExternal |
| Network framework HTTP server | Node HTTP server |
| CloudKit sync | unavailable in Windows v1 |
| WidgetKit snapshot | unavailable in Windows v1 |

## Proxy Design

The Windows proxy will be implemented as a main-process-owned Node module. It must bind to loopback only by default.

Routes to support:

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/responses/compact`
- `POST /v1/memories/trace_summarize`
- `POST /v1/alpha/search`
- `POST /v1/messages`

The proxy must preserve:

- API key validation via `Authorization: Bearer <key>` or `x-api-key`;
- CORS responses;
- SSE streaming;
- account retry across eligible accounts;
- token refresh on expired auth;
- cooldown behavior for account and auth failures;
- downstream response translation for OpenAI Chat and Anthropic-compatible clients;
- Codex-native request pass-through for Responses-related endpoints.

Request and stream buffering must be bounded. Command execution output must retain only a small tail buffer, matching the repository rule to avoid unbounded stdout/stderr accumulation.

## OAuth Design

The Windows app will keep the existing OpenAI ChatGPT OAuth flow:

- generate PKCE verifier/challenge;
- start a loopback callback server on the preferred port and nearby fallbacks;
- open the authorization URL in the user's default browser;
- validate state on callback;
- exchange code for tokens;
- optionally exchange ID token for an API key;
- normalize and store Codex-compatible auth JSON.

OAuth timeout, cancellation, and browser-open failures must surface as user-visible errors.

## Codex and Editor Integration

Codex launch behavior:

- Prefer launching the installed Codex desktop app if a reliable Windows install path is found.
- Fall back to `codex app [workspace]` if the CLI is discoverable.
- If neither is available, show the existing executable-not-found style error.

Editor restart targets:

- Visual Studio Code
- Visual Studio Code Insiders
- Cursor
- Antigravity
- Kiro
- Trae
- Qoder

Detection should use known install paths and PATH lookup. Restart should terminate only exact known process names and relaunch the detected executable.

## Packaging and Distribution

Initial build target:

- unpacked Electron app for local verification;
- Windows installer through Electron Forge after the app is functionally usable.

Preferred installer:

- Squirrel.Windows for simple user installation and update-compatible artifacts.

MSIX can be added later if distribution needs Microsoft Store, enterprise policy, or tighter Windows identity integration.

Because Windows installers generally need Windows tooling, the release pipeline should eventually run on a Windows CI runner.

## Error Handling

Errors should be explicit and user-visible when they affect workflows:

- auth file missing;
- invalid auth JSON;
- OAuth timeout or callback mismatch;
- proxy port in use;
- failed upstream requests;
- unsupported Windows feature;
- missing Codex executable;
- editor restart failure;
- import file invalid or unsupported version.

The app should log diagnostic details in the main process while returning localized, safe messages to the renderer.

## Security

- Bind local servers to loopback unless a later explicit setting changes that.
- Require the local proxy API key for all non-health endpoints.
- Store tokens only in local JSON files matching current Codex behavior.
- Avoid sending token payloads through renderer logs.
- Keep filesystem and process execution in Electron main.
- Validate all IPC inputs with schemas before use.

## Testing Plan

Unit tests:

- account ranking;
- usage window selection;
- account identity matching;
- auth parsing and normalization;
- account transfer merge;
- settings migration/defaults;
- proxy request translation;
- proxy retry policy.

Integration tests:

- OAuth callback happy path with a fake token exchange server;
- import current auth from a temp `.codex` directory;
- switch account writes `auth.json`;
- proxy health and API key validation;
- streaming proxy response path with fake upstream.

UI tests:

- accounts page can add/import/select/delete accounts using mocked IPC;
- proxy page can start/stop and copy endpoint values;
- settings page persists toggles and editor targets.

Manual Windows verification:

- install or unpack app on Windows;
- add a real account through OAuth;
- switch current account and verify `%USERPROFILE%\.codex\auth.json`;
- run `codex app`;
- run proxy with curl against `/v1/chat/completions`, `/v1/responses`, and `/v1/messages`;
- verify startup registration and editor restart behavior.

The existing macOS `swift test` remains a regression gate when shared files or docs around behavior are changed.

## Implementation Milestones

1. Scaffold `apps/windows` Electron + React + TypeScript with lint, typecheck, test, dev, package scripts.
2. Implement TypeScript domain models, repositories, and settings persistence.
3. Port account auth parsing, account import, account switching, account ranking, and transfer package merge.
4. Implement OAuth login and token refresh.
5. Implement usage and workspace metadata services.
6. Implement the local proxy and translation modules.
7. Build React UI for accounts, proxy, and settings.
8. Add Windows platform services for startup, tray, Codex launch, and editor restart.
9. Add automated tests and local verification scripts.
10. Add Windows package configuration and release documentation.

## Acceptance Criteria

The Windows goal is complete only when current evidence proves all of the following:

- A Windows app exists in the repository and can be installed or run from a packaged artifact.
- Accounts, Proxy, and Settings UI parity with the macOS app is verified with screenshots or written comparison notes.
- The app supports the account, proxy, settings, OAuth, import/export, smart switch, and editor restart workflows listed in this design.
- macOS-only features are either absent from Windows UI or clearly marked unavailable.
- Windows app data is persisted under `%APPDATA%\CodexManager`.
- current Codex auth is written under `%USERPROFILE%\.codex`.
- Unit and integration tests for the ported behavior pass.
- A manual Windows verification run confirms UI parity, OAuth, switching, Codex launch, proxy routes, and persistence.
- The existing macOS app still passes its Swift test suite.
