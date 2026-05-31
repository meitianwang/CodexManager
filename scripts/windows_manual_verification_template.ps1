param(
  [string] $ArtifactRunUrl = "__ARTIFACT_RUN_URL__",

  [string] $ArtifactDigest = "__ARTIFACT_DIGEST__",

  [string] $RepoRoot = "",

  [string] $AutomatedEvidencePath = "",

  [string] $UIParityEvidencePath = "",

  [int] $ProxyPort = 0,

  [string] $ProxyApiKey = "",

  [string] $ExpectedCurrentAccountId = "",

  [string] $OutputPath = ""
)

# Run this only after completing the Windows manual checklist in docs/release-windows.md.
# The script passes the manual verification switches to the collector as your assertion.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path ".").Path
}

if ([string]::IsNullOrWhiteSpace($AutomatedEvidencePath)) {
  $AutomatedEvidencePath = $PSScriptRoot
}

if ([string]::IsNullOrWhiteSpace($UIParityEvidencePath)) {
  $UIParityEvidencePath = Join-Path $RepoRoot "artifacts\windows-ui-parity"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $RepoRoot "artifacts\windows-manual-verification.json"
}

$CollectorPath = Join-Path $RepoRoot "scripts\collect_windows_verification.ps1"
$SmokeResultPath = Join-Path $AutomatedEvidencePath "smoke-result.json"
$ArtifactRunUrlPlaceholder = "__ARTIFACT" + "_RUN_URL__"
$ArtifactDigestPlaceholder = "__ARTIFACT" + "_DIGEST__"

if ($ArtifactRunUrl -eq $ArtifactRunUrlPlaceholder -or [string]::IsNullOrWhiteSpace($ArtifactRunUrl)) {
  throw "Pass -ArtifactRunUrl, or use the prefilled template from the CodexManager-Windows-Automated-Verification artifact."
}

if ($ArtifactDigest -eq $ArtifactDigestPlaceholder -or [string]::IsNullOrWhiteSpace($ArtifactDigest)) {
  throw "Pass -ArtifactDigest, or use the prefilled template from the CodexManager-Windows-Automated-Verification artifact."
}

if ($ProxyPort -le 0) {
  throw "Pass -ProxyPort with the running proxy port shown in the Windows app."
}

if ([string]::IsNullOrWhiteSpace($ProxyApiKey)) {
  throw "Pass -ProxyApiKey with the API key shown in the Windows app."
}

if (-not (Test-Path -LiteralPath $CollectorPath)) {
  throw "Verification collector was not found at $CollectorPath. Run this script from the repository root or pass -RepoRoot."
}

if (-not (Test-Path -LiteralPath $SmokeResultPath)) {
  throw "Packaged smoke result was not found at $SmokeResultPath. Pass -AutomatedEvidencePath pointing at the downloaded CodexManager-Windows-Automated-Verification artifact."
}

if (-not (Test-Path -LiteralPath $UIParityEvidencePath)) {
  throw "UI parity evidence was not found at $UIParityEvidencePath. Save Accounts, Proxy, and Settings screenshots or notes there before running this template."
}

$OutputDirectory = Split-Path -Parent $OutputPath
if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) {
  New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
}

$CollectorArguments = @{
  OutputPath = $OutputPath
  ArtifactRunUrl = $ArtifactRunUrl
  ArtifactDigest = $ArtifactDigest
  SmokeResultPath = $SmokeResultPath
  UIParityEvidencePath = $UIParityEvidencePath
  ProxyPort = $ProxyPort
  ProxyApiKey = $ProxyApiKey
  ProbeProxyRoutes = $true
  AppLaunchVerified = $true
  UIParityVerified = $true
  OAuthVerified = $true
  ImportCurrentAuthVerified = $true
  ImportAuthFileVerified = $true
  ImportExportPackageVerified = $true
  SwitchVerified = $true
  SmartSwitchVerified = $true
  UsageRefreshVerified = $true
  ProxyStartStopVerified = $true
  CodexLaunchVerified = $true
  SettingsPersistenceVerified = $true
  StartupVerified = $true
  EditorRestartVerified = $true
  TrayMenuVerified = $true
  RequireComplete = $true
}

if (-not [string]::IsNullOrWhiteSpace($ExpectedCurrentAccountId)) {
  $CollectorArguments.ExpectedCurrentAccountId = $ExpectedCurrentAccountId
}

& $CollectorPath @CollectorArguments
