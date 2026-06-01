# Windows Verification Status

Last updated: 2026-06-01 Asia/Shanghai.

This file tracks current evidence for the Windows app goal. It is not a release note and does not replace the manual checklist in `docs/release-windows.md`.

## Automated Evidence

- Windows CI run: https://github.com/meitianwang/CodexManager/actions/runs/26733246567
- Commit: `1a74fb4f690324df15b16813350f8ed46bfa9787`
- Result: success.
- Automated verification artifact: `CodexManager-Windows-Automated-Verification`, digest `sha256:559e914edacb3083fd4876e42f3b7d84b4aaf2e2781ae7e74c6cf4a4db5940f3`.
- Windows Squirrel artifact: `CodexManager-Windows-x64-Squirrel`, digest `sha256:984a5b0090d7dcd2b81f0e1e38e0d3231b88bac49c3ddf9cb7787c4aa48a9304`.
- Smoke screenshots artifact: `CodexManager-Windows-Smoke-Screenshots`, digest `sha256:d96c6666d93eefebf60d40597c66fc3a6dae22916797772e4bc12f968d490c6e`.
- Automated verification artifact contents were downloaded and checked locally: `automated-verification.json`, raw packaged smoke `smoke-result.json`, and prefilled `manual-verification-template.ps1`.
- Smoke screenshots artifact contents were downloaded and checked locally: `accounts.png`, `proxy.png`, and `settings.png`.
- The generated manual verification template was self-tested in Windows CI and successfully invoked the collector with named parameters and `-RequireComplete`.
- The 298 MB Squirrel artifact is present in GitHub Actions with the digest above. Local download of the large Squirrel artifact has previously failed from this macOS host with a GitHub TLS archive error, so the smaller automated report and screenshot artifacts are the locally downloaded evidence in this verification pass.
- Windows renderer tests now compare shared UI labels against the macOS `Localizable.strings` source for Accounts, Proxy, and Settings labels across all 11 locales, and verify the team-name placeholder wording for all 11 locales.
- Windows renderer tests now mirror the macOS Accounts content-state model for loading, load failure, empty, and content states, with loading/error labels verified against macOS localizations across all 11 locales.
- Windows renderer tests now mirror the macOS Accounts action descriptor busy labels for export, import package, import current auth, add account/login, weekly quota warmup, and refresh usage spinner states.
- Windows renderer tests now verify account card action labels stay `Switch`, `Refresh`, and `Delete` under localized UI, matching the macOS Swift account card implementation.
- Windows renderer tests, source smoke, packaged smoke, and the verification collector now record account-card accessibility labels separately from visible labels, including `Switch to this`, `Refresh usage`, and `Delete`.
- Windows source parity tests now compare proxy models, proxy endpoint paths, language choices, and editor restart target IDs against the macOS Swift source.
- Windows renderer tests now verify the Proxy API key label stays `API Key` for all locales, matching the macOS hard-coded `ProxyFormRow(title: "API Key")`.
- Windows platform service tests now compare shared tray labels and account-count status formatting against the macOS tray localization sources for English, Simplified Chinese, Japanese, and Korean.
- Packaged smoke now records and asserts the Accounts team-name input label `Set team name Smoke account` and placeholder `Set team name`.
- Packaged smoke now records and asserts the Accounts card action labels `Switch`, `Refresh`, and `Delete`; the downloaded Windows screenshot confirms these labels render fully at `944x471`.
- Packaged smoke now records and asserts the Proxy form labels `Port` and `API Key`.
- Packaged smoke and the Windows verification collector now assert the shared tray action labels include `Open Main Panel`, `Refresh Accounts`, `Smart Switch`, `Start Proxy`, and `Quit`.
- Packaged smoke result: passed.
- Packaged UI screenshots: Accounts, Proxy, and Settings screenshots were recorded at `944x471` with non-trivial file sizes.
- Packaged Proxy route smoke: `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/responses/compact`, `/v1/memories/trace_summarize`, `/v1/alpha/search`, and `/v1/messages` all returned `200` through smoke-safe upstream routing.
- Packaged Proxy auth smoke: missing and wrong API keys returned `401`.
- Packaged account workflows: smoke-safe OAuth import, current auth import, standalone auth file import, account package import/export, smart switch, and restored current-account persistence passed.
- Packaged platform workflows: smoke-safe Codex launch, Cursor restart, launch-at-startup toggle, and tray actions passed.
- Windows app local verification on macOS host: `pnpm run typecheck`, `pnpm test`, `pnpm run build`, source Electron smoke with screenshots, and `git diff --check` passed for the current Windows app change set. The source smoke was run under a Simplified Chinese host locale, proving the smoke controller no longer fails before seeded English UI verification.
- macOS regression gate: after `swift package clean`, `swift test` passed with 94 XCTest tests and 4 Swift Testing tests.

## Remaining Completion Evidence

The goal is not complete until a real Windows machine verifies the non-smoke behaviors below and produces a `scripts/collect_windows_verification.ps1 -RequireComplete` report:

- Installed app launches on Windows and opens Accounts.
- UI parity with the macOS app is checked from real Accounts, Proxy, and Settings screenshots or notes.
- Real ChatGPT OAuth completes in the Windows app.
- Current auth import, standalone auth import, account package import/export, account switch, and smart switch are verified against real local files.
- Usage refresh is verified with a real account or a visible user-facing usage error.
- Proxy start/stop is verified from the real Proxy page.
- Live proxy probes reach the selected real account for every supported route.
- Settings persist after app restart.
- Windows launch-at-startup registration is verified.
- Supported editor restart is verified with an installed editor.
- Codex launch after switch is verified against an installed Codex desktop app or CLI fallback.
- Tray menu behavior is verified on Windows.
