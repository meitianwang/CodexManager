# Windows Verification Status

Last updated: 2026-06-01 Asia/Shanghai.

This file tracks current evidence for the Windows app goal. It is not a release note and does not replace the manual checklist in `docs/release-windows.md`.

## Automated Evidence

- Windows CI run: https://github.com/meitianwang/CodexManager/actions/runs/26721144860
- Commit: `c0fd43288edf80e443aaa0520b2551a4eb4b70ef`
- Result: success.
- Automated verification artifact: `CodexManager-Windows-Automated-Verification`, digest `sha256:1ed7bc155903c01c8b363e59d9e8299baf9d289d9beb4b8853d03cf1752987f1`.
- Windows Squirrel artifact: `CodexManager-Windows-x64-Squirrel`, digest `sha256:78522e4fb3cd9667efa93d66bba1f8df134ab95bcbcdf13cda1fe57da02fd572`.
- Smoke screenshots artifact: `CodexManager-Windows-Smoke-Screenshots`, digest `sha256:1eadd0d8d9027729ee346db6a1ad0aaf7e1193ac1e704e3180e560cb856a4af6`.
- Automated verification artifact contents were downloaded and checked locally: `automated-verification.json`, raw packaged smoke `smoke-result.json`, and prefilled `manual-verification-template.ps1`.
- Smoke screenshots artifact contents were downloaded and checked locally: `accounts.png`, `proxy.png`, and `settings.png`.
- The generated manual verification template was self-tested in Windows CI and successfully invoked the collector with named parameters and `-RequireComplete`.
- The 298 MB Squirrel artifact is present in GitHub Actions with the digest above. Local download of the large Squirrel artifact has previously failed from this macOS host with a GitHub TLS archive error, so the smaller automated report and screenshot artifacts are the locally downloaded evidence in this verification pass.
- Windows renderer tests now compare shared English UI labels against the macOS `en.lproj/Localizable.strings` source for Accounts, Proxy, and Settings labels, and verify the team-name placeholder wording for all 11 locales.
- Packaged smoke result: passed.
- Packaged UI screenshots: Accounts, Proxy, and Settings screenshots were recorded at `944x471` with non-trivial file sizes.
- Packaged Proxy route smoke: `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/responses/compact`, `/v1/memories/trace_summarize`, `/v1/alpha/search`, and `/v1/messages` all returned `200` through smoke-safe upstream routing.
- Packaged Proxy auth smoke: missing and wrong API keys returned `401`.
- Packaged account workflows: smoke-safe OAuth import, current auth import, standalone auth file import, account package import/export, smart switch, and restored current-account persistence passed.
- Packaged platform workflows: smoke-safe Codex launch, Cursor restart, launch-at-startup toggle, and tray actions passed.
- Windows app local verification on macOS host: `pnpm run typecheck`, `pnpm test`, `pnpm run build`, and `git diff --check` passed for the current Windows app change set.
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
