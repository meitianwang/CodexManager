# Windows Release

This document covers the Electron Windows app in `apps/windows`. The Swift macOS release flow remains in `docs/release-macos.md`.

## Prerequisites

- Windows 10 or 11, or a Windows CI runner.
- Node.js with Corepack enabled.
- `pnpm` 10.x.
- PowerShell 7 or Windows PowerShell.

Windows installer artifacts should be produced on Windows. Running `pnpm run package` on macOS is useful as a compile/package smoke test, but it produces a macOS unpacked app, not a Windows installer.

## Local Verification

From the repository root:

```powershell
cd apps/windows
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
pnpm run package
```

The package smoke test writes an unpacked app under `apps/windows/out`.

## Windows Installer

From the repository root on Windows:

```powershell
.\scripts\package_windows.ps1 -Target make -Arch x64
```

The script runs typecheck, tests, build, and Electron Forge `make` for `win32`.

Expected Squirrel.Windows outputs:

- `apps/windows/out/make/squirrel.windows/x64/CodexManagerSetup.exe`
- `apps/windows/out/make/squirrel.windows/x64/*.nupkg`
- `apps/windows/out/make/squirrel.windows/x64/RELEASES`

For an unpacked app only:

```powershell
.\scripts\package_windows.ps1 -Target package -Arch x64
```

## CI Artifact Build

The `.github/workflows/windows-app.yml` workflow runs the same packaging script on `windows-latest`.

It runs on pushes and pull requests that touch the Windows app, release document, packaging script, or the workflow itself. It can also be started manually from GitHub Actions with `workflow_dispatch`.

The workflow uploads one artifact named `CodexManager-Windows-x64-Squirrel` containing:

- `CodexManagerSetup.exe`
- `*.nupkg`
- `RELEASES`

Before upload, CI also runs the packaged `CodexManager.exe` with `CODEX_MANAGER_ELECTRON_SMOKE_TEST=1`.
The smoke test waits for the process to exit, checks its result JSON, and verifies that the real packaged app starts, exposes the preload IPC bridge, renders the default Accounts page, switches to a seeded account, persists settings, starts the local proxy, passes `/health`, rejects an unauthenticated proxy request, and exits cleanly.

Treat the CI artifact as the installable Windows verification build. It is not code signed yet.

## Manual Verification Checklist

Use the CI artifact as the build under test, then keep one machine-readable verification report with the release notes or issue.

After installing `CodexManagerSetup.exe` on Windows, complete the manual actions in the checklist below. Then run this from the repository root on the same Windows machine:

```powershell
.\scripts\collect_windows_verification.ps1 `
  -ArtifactRunUrl "https://github.com/meitianwang/CodexManager/actions/runs/<run-id>" `
  -ArtifactDigest "sha256:<artifact-digest>" `
  -ExpectedCurrentAccountId "<account-id-after-switch-or-remove-this-line>" `
  -ProxyPort <port-from-proxy-page> `
  -ProxyApiKey "<api-key-from-proxy-page>" `
  -ProbeProxyRoutes `
  -AppLaunchVerified `
  -OAuthVerified `
  -ImportCurrentAuthVerified `
  -ImportExportPackageVerified `
  -SwitchVerified `
  -SmartSwitchVerified `
  -UsageRefreshVerified `
  -ProxyStartStopVerified `
  -CodexLaunchVerified `
  -SettingsPersistenceVerified `
  -StartupVerified `
  -EditorRestartVerified `
  -TrayMenuVerified `
  -RequireComplete
```

`-ProbeProxyRoutes` sends three small real requests through the selected account: `/v1/chat/completions`, `/v1/responses`, and `/v1/messages`. Omit it during dry runs. `-ExpectedCurrentAccountId` is optional, but include it when you know the ChatGPT account ID so the report can prove the active `%USERPROFILE%\.codex\auth.json` matches the account you switched to. The manual `*Verified` switches should only be passed after completing the matching checklist item below. The script records non-secret summaries only, keeps at most an 8 KB response preview per request, and writes a JSON report to `%TEMP%` unless `-OutputPath` is provided.

- App launches and opens the Accounts page.
- Accounts page can import the current `%USERPROFILE%\.codex\auth.json`.
- ChatGPT OAuth opens the default browser, completes callback, imports the account, and surfaces errors on failure.
- Switching accounts updates `%USERPROFILE%\.codex\auth.json`.
- Smart switch chooses the account with the most available quota.
- Usage refresh updates 5-hour and weekly windows or shows a user-visible error.
- Proxy page can start and stop the local proxy on the configured port.
- `GET http://127.0.0.1:<port>/health` returns `{ "ok": true }`.
- Proxy routes reject missing or wrong API keys.
- OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages requests route through the selected account.
- Settings persist after app restart.
- Launch-at-startup toggles Windows login item registration.
- Editor restart detects supported installed editors and relaunches selected targets after account switching.
- Codex launch after switching prefers the desktop app and falls back to `codex app`.
- Tray menu can show the window, refresh accounts, smart switch, start/stop proxy, and quit.

## Notes

- `apps/windows/assets/icon.svg` is the source icon. `apps/windows/assets/icon.ico` is the multi-size Windows icon wired into Electron Forge `packagerConfig.icon`, BrowserWindow, and the Squirrel setup executable.
- Signing and auto-update publishing are intentionally not configured yet. Add them only after a Windows CI runner and certificate strategy are selected.
