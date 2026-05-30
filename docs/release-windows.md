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

## Manual Verification Checklist

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

- `apps/windows/assets/icon.svg` is the source icon. Before a production Windows installer, convert it to a multi-size `.ico` and wire it into Electron Forge `packagerConfig.icon` / Squirrel setup icon settings.
- Signing and auto-update publishing are intentionally not configured yet. Add them only after a Windows CI runner and certificate strategy are selected.
