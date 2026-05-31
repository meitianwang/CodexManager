param(
  [string] $OutputPath = "",

  [string] $ArtifactRunUrl = "",

  [string] $ArtifactDigest = "",

  [string] $SmokeResultPath = "",

  [string] $ExpectedCurrentAccountId = "",

  [string] $UIParityEvidencePath = "",

  [int] $ProxyPort = 0,

  [string] $ProxyApiKey = "",

  [switch] $ProbeProxyRoutes,

  [switch] $AppLaunchVerified,

  [switch] $UIParityVerified,

  [switch] $OAuthVerified,

  [switch] $ImportCurrentAuthVerified,

  [switch] $ImportAuthFileVerified,

  [switch] $ImportExportPackageVerified,

  [switch] $SwitchVerified,

  [switch] $SmartSwitchVerified,

  [switch] $UsageRefreshVerified,

  [switch] $ProxyStartStopVerified,

  [switch] $CodexLaunchVerified,

  [switch] $SettingsPersistenceVerified,

  [switch] $StartupVerified,

  [switch] $EditorRestartVerified,

  [switch] $TrayMenuVerified,

  [switch] $RequireAutomated,

  [switch] $RequireComplete
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
Add-Type -AssemblyName System.Net.Http

$MaxBodyBytes = 8192
$JsonReadLimitBytes = 1048576
$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path ([System.IO.Path]::GetTempPath()) "codexmanager-windows-verification-$Timestamp.json"
}

$Checks = [ordered]@{}

function Add-Check {
  param(
    [string] $Name,
    [bool] $Passed,
    [object] $Detail
  )

  $script:Checks[$Name] = [ordered]@{
    passed = $Passed
    detail = $Detail
  }
}

function Get-PropertyValue {
  param(
    [object] $Object,
    [string] $Name
  )

  if ($null -eq $Object) {
    return $null
  }

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

function Get-StringValue {
  param(
    [object] $Value
  )

  if ($null -eq $Value) {
    return $null
  }

  return [string] $Value
}

function Get-ArrayCount {
  param(
    [object] $Value
  )

  if ($null -eq $Value) {
    return 0
  }

  return @($Value).Count
}

function Get-BoolValue {
  param(
    [object] $Value
  )

  return $Value -eq $true
}

function Get-NumberValue {
  param(
    [object] $Value
  )

  if ($null -eq $Value) {
    return 0
  }

  try {
    return [double] $Value
  } catch {
    return 0
  }
}

function Test-ContainsAll {
  param(
    [object] $Values,
    [string[]] $ExpectedValues
  )

  $items = @($Values | ForEach-Object { [string] $_ })
  foreach ($expectedValue in $ExpectedValues) {
    if ($items -notcontains $expectedValue) {
      return $false
    }
  }

  return $true
}

function Test-ContainsAllBooleans {
  param(
    [object] $Values,
    [bool[]] $ExpectedValues
  )

  if ($null -eq $Values) {
    return $false
  }

  $items = @($Values | ForEach-Object { $_ -eq $true })
  foreach ($expectedValue in $ExpectedValues) {
    if ($items -notcontains $expectedValue) {
      return $false
    }
  }

  return $true
}

function Decode-JwtPayload {
  param(
    [string] $Token
  )

  if ([string]::IsNullOrWhiteSpace($Token)) {
    return $null
  }

  $parts = $Token -split "\."
  if ($parts.Count -lt 2) {
    return $null
  }

  $payload = $parts[1].Replace("-", "+").Replace("_", "/")
  switch ($payload.Length % 4) {
    2 { $payload = "$payload==" }
    3 { $payload = "$payload=" }
    1 { return $null }
  }

  try {
    $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
    return $json | ConvertFrom-Json -ErrorAction Stop
  } catch {
    return $null
  }
}

function Get-AccountsStoreSummary {
  param(
    [object] $Store
  )

  $accounts = Get-PropertyValue $Store "accounts"
  $currentSelection = Get-PropertyValue $Store "currentSelection"
  $accountIds = @()
  if ($null -ne $accounts) {
    $accountIds = @($accounts | ForEach-Object { Get-StringValue (Get-PropertyValue $_ "accountId") } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 20)
  }

  return [ordered]@{
    version = Get-PropertyValue $Store "version"
    accountsCount = Get-ArrayCount $accounts
    accountIdsPreview = $accountIds
    currentSelectionAccountId = Get-StringValue (Get-PropertyValue $currentSelection "accountId")
    currentSelectionAccountKey = Get-StringValue (Get-PropertyValue $currentSelection "accountKey")
    currentSelectionSelectedAt = Get-PropertyValue $currentSelection "selectedAt"
  }
}

function Get-SettingsSummary {
  param(
    [object] $Settings
  )

  return [ordered]@{
    locale = Get-StringValue (Get-PropertyValue $Settings "locale")
    launchAtStartup = Get-PropertyValue $Settings "launchAtStartup"
    launchCodexAfterSwitch = Get-PropertyValue $Settings "launchCodexAfterSwitch"
    autoSmartSwitch = Get-PropertyValue $Settings "autoSmartSwitch"
    restartEditorsOnSwitch = Get-PropertyValue $Settings "restartEditorsOnSwitch"
    restartEditorTargetsCount = Get-ArrayCount (Get-PropertyValue $Settings "restartEditorTargets")
    proxyPort = Get-PropertyValue $Settings "proxyPort"
    proxyApiKeyConfigured = -not [string]::IsNullOrWhiteSpace((Get-StringValue (Get-PropertyValue $Settings "proxyApiKey")))
    autoStartProxy = Get-PropertyValue $Settings "autoStartProxy"
  }
}

function Get-CodexAuthSummary {
  param(
    [object] $Auth
  )

  $tokens = Get-PropertyValue $Auth "tokens"
  $idToken = Get-StringValue (Get-PropertyValue $tokens "id_token")
  $claims = Decode-JwtPayload $idToken
  $openAIClaims = Get-PropertyValue $claims "https://api.openai.com/auth"

  $accountId = Get-StringValue (Get-PropertyValue $tokens "account_id")
  if ([string]::IsNullOrWhiteSpace($accountId)) {
    $accountId = Get-StringValue (Get-PropertyValue $openAIClaims "chatgpt_account_id")
  }

  $principalId = Get-StringValue (Get-PropertyValue $tokens "principal_id")
  if ([string]::IsNullOrWhiteSpace($principalId)) {
    $principalId = Get-StringValue (Get-PropertyValue $claims "sub")
  }

  return [ordered]@{
    authMode = Get-StringValue (Get-PropertyValue $Auth "auth_mode")
    accountId = $accountId
    principalId = $principalId
    email = Get-StringValue (Get-PropertyValue $claims "email")
    planType = Get-StringValue (Get-PropertyValue $openAIClaims "chatgpt_plan_type")
    teamName = Get-StringValue (Get-PropertyValue $openAIClaims "chatgpt_team_name")
    hasAccessToken = -not [string]::IsNullOrWhiteSpace((Get-StringValue (Get-PropertyValue $tokens "access_token")))
    hasRefreshToken = -not [string]::IsNullOrWhiteSpace((Get-StringValue (Get-PropertyValue $tokens "refresh_token")))
    hasIdToken = -not [string]::IsNullOrWhiteSpace($idToken)
    lastRefresh = Get-StringValue (Get-PropertyValue $Auth "last_refresh")
  }
}

function Get-JsonFileStatus {
  param(
    [string] $Path,
    [ValidateSet("none", "accounts", "settings", "codexAuth")]
    [string] $SummaryKind = "none"
  )

  $status = [ordered]@{
    path = $Path
    exists = $false
    sizeBytes = 0
    validJson = $false
    summary = $null
    error = $null
  }

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $status
  }

  $item = Get-Item -LiteralPath $Path
  $status.exists = $true
  $status.sizeBytes = $item.Length

  if ($item.Length -gt $JsonReadLimitBytes) {
    $status.error = "File is larger than $JsonReadLimitBytes bytes; skipped JSON parsing."
    return $status
  }

  try {
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
    $status.validJson = $true
    if ($SummaryKind -eq "accounts") {
      $status.summary = Get-AccountsStoreSummary $parsed
    } elseif ($SummaryKind -eq "settings") {
      $status.summary = Get-SettingsSummary $parsed
    } elseif ($SummaryKind -eq "codexAuth") {
      $status.summary = Get-CodexAuthSummary $parsed
    }
  } catch {
    $status.error = $_.Exception.Message
  }

  return $status
}

function Get-SmokeResultStatus {
  param(
    [string] $Path
  )

  $status = [ordered]@{
    path = $Path
    exists = $false
    sizeBytes = 0
    validJson = $false
    result = $null
    summary = $null
    error = $null
  }

  if ([string]::IsNullOrWhiteSpace($Path)) {
    $status.error = "Smoke result path was not provided."
    return $status
  }

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    $status.error = "Smoke result file does not exist."
    return $status
  }

  $item = Get-Item -LiteralPath $Path
  $status.exists = $true
  $status.sizeBytes = $item.Length

  if ($item.Length -gt $JsonReadLimitBytes) {
    $status.error = "Smoke result is larger than $JsonReadLimitBytes bytes; skipped JSON parsing."
    return $status
  }

  try {
    $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
    $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
    $status.validJson = $true
    $status.result = $parsed
    $state = Get-PropertyValue $parsed "state"
    $workflows = Get-PropertyValue $parsed "workflows"
    $status.summary = [ordered]@{
      status = Get-StringValue (Get-PropertyValue $parsed "status")
      activePage = Get-StringValue (Get-PropertyValue $state "activePage")
      pageTitle = Get-StringValue (Get-PropertyValue $state "pageTitle")
      hasBridge = Get-PropertyValue $state "hasBridge"
      uiSnapshotCount = Get-ArrayCount (Get-PropertyValue $parsed "uiSnapshots")
      proxyPort = Get-PropertyValue $workflows "proxyPort"
      switchedAccountId = Get-StringValue (Get-PropertyValue $workflows "switchedAccountId")
    }
  } catch {
    $status.error = $_.Exception.Message
  }

  return $status
}

function Get-SmokeSnapshot {
  param(
    [object] $Result,
    [string] $Page
  )

  $snapshots = Get-PropertyValue $Result "uiSnapshots"
  if ($null -eq $snapshots) {
    return $null
  }

  foreach ($snapshot in @($snapshots)) {
    if ((Get-StringValue (Get-PropertyValue $snapshot "page")) -eq $Page) {
      return $snapshot
    }
  }

  return $null
}

function Test-SmokeResultPassed {
  param(
    [object] $Result
  )

  return (Get-StringValue (Get-PropertyValue $Result "status")) -eq "passed"
}

function Add-SmokeResultChecks {
  param(
    [string] $Path
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return
  }

  $smokeStatus = Get-SmokeResultStatus $Path
  $smokeResult = $smokeStatus["result"]
  $smokeResultPassed = $smokeStatus["exists"] -and $smokeStatus["validJson"] -and (Test-SmokeResultPassed $smokeResult)
  Add-Check "automated.smokeResultJson" $smokeResultPassed $smokeStatus
  if (-not $smokeResultPassed) {
    return
  }

  $result = $smokeResult
  $state = Get-PropertyValue $result "state"
  Add-Check "automated.packagedAppLaunch" (
    (Get-BoolValue (Get-PropertyValue $state "hasBridge")) -and
    (Get-StringValue (Get-PropertyValue $state "activePage")) -eq "accounts" -and
    (Get-StringValue (Get-PropertyValue $state "pageTitle")) -eq "Accounts" -and
    (Get-NumberValue (Get-PropertyValue $state "bodyLength")) -gt 100
  ) $state

  $screenshotDetails = [ordered]@{}
  $screenshotsPassed = $true
  foreach ($page in @("accounts", "proxy", "settings")) {
    $snapshot = Get-SmokeSnapshot $result $page
    $screenshotPath = Get-StringValue (Get-PropertyValue $snapshot "screenshotPath")
    $fileLength = 0
    $fileExists = $false
    if (-not [string]::IsNullOrWhiteSpace($screenshotPath) -and (Test-Path -LiteralPath $screenshotPath -PathType Leaf)) {
      $item = Get-Item -LiteralPath $screenshotPath
      $fileExists = $true
      $fileLength = $item.Length
    }
    $pagePassed = (
      $null -ne $snapshot -and
      $fileExists -and
      (Get-NumberValue (Get-PropertyValue $snapshot "screenshotWidth")) -ge 900 -and
      (Get-NumberValue (Get-PropertyValue $snapshot "screenshotHeight")) -ge 450 -and
      (Get-NumberValue (Get-PropertyValue $snapshot "screenshotByteLength")) -ge 10000 -and
      $fileLength -ge 10000
    )
    if (-not $pagePassed) {
      $screenshotsPassed = $false
    }
    $screenshotDetails[$page] = [ordered]@{
      passed = $pagePassed
      path = $screenshotPath
      fileExists = $fileExists
      fileLength = $fileLength
      width = Get-PropertyValue $snapshot "screenshotWidth"
      height = Get-PropertyValue $snapshot "screenshotHeight"
      byteLength = Get-PropertyValue $snapshot "screenshotByteLength"
    }
  }
  Add-Check "automated.uiScreenshots" $screenshotsPassed $screenshotDetails

  $fingerprintDetails = [ordered]@{}
  $fingerprintsPassed = $true
  foreach ($page in @("accounts", "proxy", "settings")) {
    $snapshot = Get-SmokeSnapshot $result $page
    $fingerprint = Get-PropertyValue $snapshot "fingerprint"
    $pagePassed = (
      $null -ne $fingerprint -and
      (Get-NumberValue (Get-PropertyValue $fingerprint "navItemCount")) -eq 3 -and
      (Get-StringValue (Get-PropertyValue $fingerprint "sidebarBrand")) -eq "CodexManager" -and
      (Get-StringValue (Get-PropertyValue $fingerprint "sidebarStatus")) -match "^Proxy:"
    )

    if ($page -eq "accounts") {
      $accounts = Get-PropertyValue $fingerprint "accounts"
      $pagePassed = $pagePassed -and
        (Get-NumberValue (Get-PropertyValue $accounts "accountCount")) -eq 1 -and
        (Get-NumberValue (Get-PropertyValue $accounts "currentBadgeCount")) -eq 1 -and
        (Get-BoolValue (Get-PropertyValue $accounts "hasSmokeEmail")) -and
        (Test-ContainsAll (Get-PropertyValue $accounts "toolbarButtons") @("Export accounts", "Import file", "Import current auth", "Add account", "Smart switch", "Warm up weekly quota")) -and
        (Test-ContainsAll (Get-PropertyValue $accounts "actionButtons") @("Switch", "Refresh", "Delete"))
    } elseif ($page -eq "proxy") {
      $proxy = Get-PropertyValue $fingerprint "proxy"
      $pagePassed = $pagePassed -and
        (Test-ContainsAll (Get-PropertyValue $proxy "sectionHeadings") @("Proxy", "Proxy Control", "Endpoints", "Available Models", "Usage")) -and
        (Test-ContainsAll (Get-PropertyValue $proxy "endpointPaths") @("/v1/chat/completions", "/v1/responses", "/v1/messages")) -and
        (Test-ContainsAll (Get-PropertyValue $proxy "formLabels") @("Port", "API key")) -and
        (Test-ContainsAll (Get-PropertyValue $proxy "actionButtons") @("Start")) -and
        (Get-NumberValue (Get-PropertyValue $proxy "codeCopyButtonCount")) -eq 2 -and
        (Get-NumberValue (Get-PropertyValue $proxy "modelChipCount")) -ge 3 -and
        (Get-StringValue (Get-PropertyValue $proxy "statusText")) -eq "Stopped"
    } else {
      $settings = Get-PropertyValue $fingerprint "settings"
      $pagePassed = $pagePassed -and
        (Test-ContainsAll (Get-PropertyValue $settings "sectionHeadings") @("Settings", "General", "Switch Behavior", "Language")) -and
        (Test-ContainsAll (Get-PropertyValue $settings "toggleLabels") @("Launch at startup", "Auto-start API proxy on launch", "Launch Codex after switch", "Auto smart switch", "Restart editors on switch")) -and
        (Test-ContainsAll (Get-PropertyValue $settings "selectLabels") @("Editor restart target", "Language")) -and
        (Test-ContainsAll (Get-PropertyValue $settings "footerButtons") @("GitHub Star", "Quit")) -and
        (Get-NumberValue (Get-PropertyValue $settings "languageOptionCount")) -eq 11
    }

    if (-not $pagePassed) {
      $fingerprintsPassed = $false
    }
    $fingerprintDetails[$page] = [ordered]@{
      passed = $pagePassed
      fingerprint = $fingerprint
    }
  }
  Add-Check "automated.uiFingerprints" $fingerprintsPassed $fingerprintDetails

  $workflows = Get-PropertyValue $result "workflows"
  $persistence = Get-PropertyValue $workflows "persistence"
  $expectedAccountId = "acct-smoke"
  if (-not [string]::IsNullOrWhiteSpace($ExpectedCurrentAccountId)) {
    $expectedAccountId = $ExpectedCurrentAccountId
  }
  Add-Check "automated.persistence" (
    (Get-BoolValue (Get-PropertyValue $persistence "accountsJsonExists")) -and
    (Get-BoolValue (Get-PropertyValue $persistence "settingsJsonExists")) -and
    (Get-BoolValue (Get-PropertyValue $persistence "codexAuthExists")) -and
    (Get-NumberValue (Get-PropertyValue $persistence "accountsCount")) -eq 1 -and
    (Get-StringValue (Get-PropertyValue $persistence "currentSelectionAccountId")) -eq $expectedAccountId -and
    (Get-StringValue (Get-PropertyValue $persistence "codexAuthAccountId")) -eq $expectedAccountId -and
    (Get-StringValue (Get-PropertyValue $persistence "settingsLocale")) -eq "en"
  ) $persistence

  $accountWorkflows = Get-PropertyValue $workflows "accounts"
  Add-Check "automated.accountWorkflows" (
    (Get-StringValue (Get-PropertyValue $accountWorkflows "importCurrentAuthAccountId")) -eq "acct-import" -and
    (Get-StringValue (Get-PropertyValue $accountWorkflows "importCurrentAuthLabel")) -eq "Imported smoke account" -and
    (Get-NumberValue (Get-PropertyValue $accountWorkflows "importPackageInsertedCount")) -eq 1 -and
    (Get-NumberValue (Get-PropertyValue $accountWorkflows "importPackageUpdatedCount")) -eq 0 -and
    (Get-StringValue (Get-PropertyValue $accountWorkflows "oauthAccountId")) -eq "acct-oauth" -and
    (Get-StringValue (Get-PropertyValue $accountWorkflows "oauthLabel")) -eq "OAuth smoke account" -and
    (Get-NumberValue (Get-PropertyValue $accountWorkflows "oauthSignInCount")) -ge 1 -and
    (Get-NumberValue (Get-PropertyValue $accountWorkflows "oauthTimeoutSeconds")) -eq 7 -and
    (Get-StringValue (Get-PropertyValue $accountWorkflows "importAuthFileKind")) -eq "auth" -and
    (Get-StringValue (Get-PropertyValue $accountWorkflows "importAuthFileAccountId")) -eq "acct-file" -and
    (Get-StringValue (Get-PropertyValue $accountWorkflows "importAuthFileLabel")) -eq "file@example.com" -and
    (Get-NumberValue (Get-PropertyValue $accountWorkflows "exportPackageAccountCount")) -eq 5 -and
    (Get-StringValue (Get-PropertyValue $accountWorkflows "smartSwitchAccountId")) -eq "acct-package" -and
    (Get-NumberValue (Get-PropertyValue $accountWorkflows "restoredAccountCount")) -eq 1
  ) $accountWorkflows

  $platform = Get-PropertyValue $workflows "platform"
  Add-Check "automated.platformSideEffects" (
    (Get-BoolValue (Get-PropertyValue $platform "usedFallbackCLI")) -and
    (Get-NumberValue (Get-PropertyValue $platform "codexLaunchCount")) -ge 1 -and
    (Get-StringValue (Get-PropertyValue $platform "codexWorkspacePath")) -eq "C:\smoke-workspace" -and
    (Get-NumberValue (Get-PropertyValue $platform "editorRestartCount")) -ge 1 -and
    (Test-ContainsAll (Get-PropertyValue $platform "restartedEditorApps") @("cursor")) -and
    (Test-ContainsAllBooleans (Get-PropertyValue $platform "startupSetEnabledValues") @($true, $false)) -and
    ([string]::IsNullOrWhiteSpace((Get-StringValue (Get-PropertyValue $platform "editorRestartError"))))
  ) $platform

  $tray = Get-PropertyValue $workflows "tray"
  Add-Check "automated.traySmoke" (
    (Test-ContainsAll (Get-PropertyValue $tray "actionLabels") @("Show Window", "Refresh Accounts", "Smart Switch", "Start Proxy", "Quit")) -and
    (Test-ContainsAll (Get-PropertyValue $tray "completedActions") @("showWindow", "refreshAccounts", "smartSwitch", "startProxy", "stopProxy", "quit")) -and
    (Test-ContainsAllBooleans (Get-PropertyValue $tray "proxyToggleSequence") @($true, $false)) -and
    (Get-NumberValue (Get-PropertyValue $tray "primaryClickShowWindowCount")) -ge 2 -and
    (Get-BoolValue (Get-PropertyValue $tray "quitRequested")) -and
    (Get-NumberValue (Get-PropertyValue $tray "refreshAccountCount")) -ge 1 -and
    (-not ([string]::IsNullOrWhiteSpace((Get-StringValue (Get-PropertyValue $tray "smartSwitchAccountId")))))
  ) $tray

  Add-Check "automated.proxySmoke" (
    (Get-BoolValue (Get-PropertyValue $workflows "proxyHealthOK")) -and
    (Get-NumberValue (Get-PropertyValue $workflows "proxyPort")) -gt 0 -and
    (Get-NumberValue (Get-PropertyValue $workflows "proxyUnauthorizedStatus")) -eq 401
  ) $workflows
}

function Get-EvidencePathStatus {
  param(
    [string] $Path
  )

  $status = [ordered]@{
    path = $Path
    exists = $false
    kind = $null
    fileCount = 0
    filesPreview = @()
    error = $null
  }

  if ([string]::IsNullOrWhiteSpace($Path)) {
    $status.error = "Evidence path was not provided."
    return $status
  }

  try {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      $item = Get-Item -LiteralPath $Path
      $status.exists = $true
      $status.kind = "file"
      $status.fileCount = 1
      $status.filesPreview = @($item.Name)
      return $status
    }

    if (Test-Path -LiteralPath $Path -PathType Container) {
      $files = @(Get-ChildItem -LiteralPath $Path -File -ErrorAction Stop | Select-Object -First 20)
      $status.exists = $true
      $status.kind = "directory"
      $status.fileCount = $files.Count
      $status.filesPreview = @($files | ForEach-Object { $_.Name })
      return $status
    }

    $status.error = "Evidence path does not exist."
  } catch {
    $status.error = $_.Exception.Message
  }

  return $status
}

function Get-PngDimensions {
  param(
    [string] $Path
  )

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    if ($stream.Length -lt 24) {
      return $null
    }

    $bytes = [byte[]]::new(24)
    $read = $stream.Read($bytes, 0, 24)
    $isPng = (
      $read -eq 24 -and
      $bytes[0] -eq 0x89 -and
      $bytes[1] -eq 0x50 -and
      $bytes[2] -eq 0x4E -and
      $bytes[3] -eq 0x47 -and
      $bytes[4] -eq 0x0D -and
      $bytes[5] -eq 0x0A -and
      $bytes[6] -eq 0x1A -and
      $bytes[7] -eq 0x0A
    )
    if (-not $isPng) {
      return $null
    }

    $width = ([int] $bytes[16] -shl 24) -bor ([int] $bytes[17] -shl 16) -bor ([int] $bytes[18] -shl 8) -bor [int] $bytes[19]
    $height = ([int] $bytes[20] -shl 24) -bor ([int] $bytes[21] -shl 16) -bor ([int] $bytes[22] -shl 8) -bor [int] $bytes[23]
    return [ordered]@{
      width = $width
      height = $height
    }
  } finally {
    $stream.Dispose()
  }
}

function Get-UIParityEvidenceStatus {
  param(
    [string] $Path
  )

  $status = Get-EvidencePathStatus $Path
  $status["requiredPages"] = [ordered]@{}
  $status["requiredPagesPassed"] = $false

  if (-not $status.exists) {
    return $status
  }

  try {
    $files = @()
    if ($status.kind -eq "file") {
      $files = @(Get-Item -LiteralPath $Path)
    } elseif ($status.kind -eq "directory") {
      $files = @(Get-ChildItem -LiteralPath $Path -File -Recurse -ErrorAction Stop | Select-Object -First 100)
    }

    $requiredPages = @("accounts", "proxy", "settings")
    foreach ($page in $requiredPages) {
      $matches = @($files | Where-Object { $_.BaseName -match "(?i)$page" })
      if ($matches.Count -eq 0) {
        $status["requiredPages"][$page] = [ordered]@{
          passed = $false
          error = "No evidence file name contained '$page'."
        }
        continue
      }

      $candidateStatuses = @()
      foreach ($item in $matches) {
        $pngDimensions = $null
        $pagePassed = $item.Length -gt 0
        if ($item.Extension -ieq ".png") {
          $pngDimensions = Get-PngDimensions $item.FullName
          $pagePassed = (
            $item.Length -ge 10000 -and
            $null -ne $pngDimensions -and
            $pngDimensions["width"] -ge 900 -and
            $pngDimensions["height"] -ge 450
          )
        }

        $candidateStatuses += [ordered]@{
          passed = $pagePassed
          path = $item.FullName
          sizeBytes = $item.Length
          extension = $item.Extension
          pngDimensions = $pngDimensions
        }
      }

      $passedCandidates = @($candidateStatuses | Where-Object { $_.passed })
      $selectedCandidate = $candidateStatuses[0]
      if ($passedCandidates.Count -gt 0) {
        $selectedCandidate = $passedCandidates[0]
      }
      $status["requiredPages"][$page] = [ordered]@{
        passed = $selectedCandidate.passed
        path = $selectedCandidate.path
        sizeBytes = $selectedCandidate.sizeBytes
        extension = $selectedCandidate.extension
        pngDimensions = $selectedCandidate.pngDimensions
        candidateCount = $candidateStatuses.Count
      }
    }

    $status["requiredPagesPassed"] = -not (@($status["requiredPages"].GetEnumerator() | Where-Object { -not $_.Value.passed }).Count -gt 0)
  } catch {
    $status.error = $_.Exception.Message
  }

  return $status
}

function New-HttpClient {
  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(90)
  return $client
}

function Invoke-BoundedHttpRequest {
  param(
    [System.Net.Http.HttpClient] $Client,
    [string] $Method,
    [string] $Url,
    [hashtable] $Headers = @{},
    [string] $Body = ""
  )

  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), $Url)
  foreach ($key in $Headers.Keys) {
    if ($key -ieq "Content-Type") {
      continue
    }
    $null = $request.Headers.TryAddWithoutValidation($key, [string] $Headers[$key])
  }

  if (-not [string]::IsNullOrEmpty($Body)) {
    $contentType = $Headers["Content-Type"]
    if ([string]::IsNullOrWhiteSpace($contentType)) {
      $contentType = "application/json"
    }
    $request.Content = [System.Net.Http.StringContent]::new($Body, [System.Text.Encoding]::UTF8, [string] $contentType)
  }

  try {
    $response = $Client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    try {
      $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
      try {
        $buffer = [byte[]]::new([Math]::Min(4096, $MaxBodyBytes))
        $memory = [System.IO.MemoryStream]::new()
        try {
          $total = 0
          while ($total -lt $MaxBodyBytes) {
            $remaining = $MaxBodyBytes - $total
            $readSize = [Math]::Min($buffer.Length, $remaining)
            $read = $stream.Read($buffer, 0, $readSize)
            if ($read -le 0) {
              break
            }
            $memory.Write($buffer, 0, $read)
            $total += $read
          }

          $truncated = $stream.ReadByte() -ge 0
          $bodyPreview = [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
          return [ordered]@{
            ok = $response.IsSuccessStatusCode
            statusCode = [int] $response.StatusCode
            bodyPreview = $bodyPreview
            bodyTruncated = $truncated
          }
        } finally {
          $memory.Dispose()
        }
      } finally {
        $stream.Dispose()
      }
    } finally {
      $response.Dispose()
    }
  } catch {
    return [ordered]@{
      ok = $false
      statusCode = 0
      bodyPreview = ""
      bodyTruncated = $false
      error = $_.Exception.Message
    }
  } finally {
    $request.Dispose()
  }
}

function Test-ProxyRoutes {
  param(
    [System.Net.Http.HttpClient] $Client,
    [string] $BaseUrl,
    [string] $ApiKey
  )

  $headers = @{
    "Authorization" = "Bearer $ApiKey"
    "Content-Type" = "application/json"
  }
  $anthropicHeaders = @{
    "anthropic-version" = "2023-06-01"
    "Content-Type" = "application/json"
    "x-api-key" = $ApiKey
  }

  return [ordered]@{
    models = Invoke-BoundedHttpRequest `
      -Client $Client `
      -Method "GET" `
      -Url "$BaseUrl/v1/models" `
      -Headers @{ "Authorization" = "Bearer $ApiKey" }
    chatCompletions = Invoke-BoundedHttpRequest `
      -Client $Client `
      -Method "POST" `
      -Url "$BaseUrl/v1/chat/completions" `
      -Headers $headers `
      -Body '{"model":"gpt-5","messages":[{"role":"user","content":"Reply with exactly: ok"}],"stream":false}'
    responses = Invoke-BoundedHttpRequest `
      -Client $Client `
      -Method "POST" `
      -Url "$BaseUrl/v1/responses" `
      -Headers $headers `
      -Body '{"model":"gpt-5","input":"Reply with exactly: ok"}'
    responsesCompact = Invoke-BoundedHttpRequest `
      -Client $Client `
      -Method "POST" `
      -Url "$BaseUrl/v1/responses/compact" `
      -Headers $headers `
      -Body '{"model":"gpt-5-codex","stream":false,"input":[{"role":"user","content":"compact this"}],"tools":[],"parallel_tool_calls":true}'
    memoriesTraceSummarize = Invoke-BoundedHttpRequest `
      -Client $Client `
      -Method "POST" `
      -Url "$BaseUrl/v1/memories/trace_summarize" `
      -Headers $headers `
      -Body '{"model":"gpt-5-codex","traces":[],"reasoning":{"effort":"low"}}'
    alphaSearch = Invoke-BoundedHttpRequest `
      -Client $Client `
      -Method "POST" `
      -Url "$BaseUrl/v1/alpha/search" `
      -Headers $headers `
      -Body '{"query":"codex","commands":[]}'
    messages = Invoke-BoundedHttpRequest `
      -Client $Client `
      -Method "POST" `
      -Url "$BaseUrl/v1/messages" `
      -Headers $anthropicHeaders `
      -Body '{"model":"gpt-5","max_tokens":16,"messages":[{"role":"user","content":"Reply with exactly: ok"}]}'
  }
}

Add-Check "artifact.runUrl" ($ArtifactRunUrl -match "^https://github\.com/.+/actions/runs/\d+$") "CI run URL for the Windows artifact under test."
Add-Check "artifact.digest" ($ArtifactDigest -match "^sha256:[0-9a-fA-F]{64}$") "Expected format: sha256:<64 hex chars>."
Add-Check "environment.windows" ([Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) "Manual verification must run on Windows."
Add-SmokeResultChecks $SmokeResultPath

Add-Check "manual.appLaunch" $AppLaunchVerified.IsPresent "Pass -AppLaunchVerified only after the installed app opens and shows the Accounts page."
$uiEvidenceStatus = Get-UIParityEvidenceStatus $UIParityEvidencePath
Add-Check "manual.uiParity" ($UIParityVerified.IsPresent -and $uiEvidenceStatus.exists -and $uiEvidenceStatus["requiredPagesPassed"]) ([ordered]@{
  instruction = "Pass -UIParityVerified only after comparing Accounts, Proxy, and Settings UI with the macOS app and storing page-specific screenshots or notes at -UIParityEvidencePath."
  evidence = $uiEvidenceStatus
})
Add-Check "manual.oauth" $OAuthVerified.IsPresent "Pass -OAuthVerified only after completing ChatGPT OAuth in the Windows app."
Add-Check "manual.importCurrentAuth" $ImportCurrentAuthVerified.IsPresent "Pass -ImportCurrentAuthVerified only after importing the current Codex auth file."
Add-Check "manual.importAuthFile" $ImportAuthFileVerified.IsPresent "Pass -ImportAuthFileVerified only after importing a selected auth.json file through Import file."
Add-Check "manual.importExportPackage" $ImportExportPackageVerified.IsPresent "Pass -ImportExportPackageVerified only after exporting and importing an account transfer package."
Add-Check "manual.switch" $SwitchVerified.IsPresent "Pass -SwitchVerified only after switching accounts and checking the active auth."
Add-Check "manual.smartSwitch" $SmartSwitchVerified.IsPresent "Pass -SmartSwitchVerified only after confirming Smart Switch chooses the best available account."
Add-Check "manual.usageRefresh" $UsageRefreshVerified.IsPresent "Pass -UsageRefreshVerified only after refreshing usage or confirming a user-visible usage error."
Add-Check "manual.proxyStartStop" $ProxyStartStopVerified.IsPresent "Pass -ProxyStartStopVerified only after starting and stopping the proxy from the Proxy page."
Add-Check "manual.codexLaunch" $CodexLaunchVerified.IsPresent "Pass -CodexLaunchVerified only after confirming Codex launches after account switch."
Add-Check "manual.settingsPersistence" $SettingsPersistenceVerified.IsPresent "Pass -SettingsPersistenceVerified only after restarting the app and confirming settings persist."
Add-Check "manual.startupRegistration" $StartupVerified.IsPresent "Pass -StartupVerified only after confirming Windows login item registration."
Add-Check "manual.editorRestart" $EditorRestartVerified.IsPresent "Pass -EditorRestartVerified only after confirming selected editors relaunch after account switch."
Add-Check "manual.trayMenu" $TrayMenuVerified.IsPresent "Pass -TrayMenuVerified only after exercising show, refresh, smart switch, proxy toggle, and quit from the tray menu."

if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
  Add-Check "paths.appDataEnv" $false "APPDATA is not set."
} else {
  $appDataRoot = Join-Path $env:APPDATA "CodexManager"
  $accountsStatus = Get-JsonFileStatus (Join-Path $appDataRoot "accounts.json") -SummaryKind "accounts"
  $settingsStatus = Get-JsonFileStatus (Join-Path $appDataRoot "settings.json") -SummaryKind "settings"
  Add-Check "paths.accountsJson" ($accountsStatus.exists -and $accountsStatus.validJson) $accountsStatus
  Add-Check "paths.settingsJson" ($settingsStatus.exists -and $settingsStatus.validJson) $settingsStatus
}

if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
  Add-Check "paths.userProfileEnv" $false "USERPROFILE is not set."
} else {
  $codexAuthStatus = Get-JsonFileStatus (Join-Path (Join-Path $env:USERPROFILE ".codex") "auth.json") -SummaryKind "codexAuth"
  $codexAuthPassed = $codexAuthStatus.exists -and $codexAuthStatus.validJson
  if ($codexAuthPassed -and -not [string]::IsNullOrWhiteSpace($ExpectedCurrentAccountId)) {
    $codexAuthSummary = $codexAuthStatus["summary"]
    $codexAuthPassed = $null -ne $codexAuthSummary -and $codexAuthSummary["accountId"] -eq $ExpectedCurrentAccountId
  }
  Add-Check "paths.codexAuthJson" $codexAuthPassed $codexAuthStatus
}

if ($ProxyPort -le 0) {
  Add-Check "proxy.health" $false "Pass -ProxyPort after starting the proxy in the Windows app."
  Add-Check "proxy.rejectsMissingApiKey" $false "Pass -ProxyPort after starting the proxy in the Windows app."
  Add-Check "proxy.rejectsWrongApiKey" $false "Pass -ProxyPort after starting the proxy in the Windows app."
  Add-Check "proxy.routes" $false "Pass -ProbeProxyRoutes, -ProxyPort, and -ProxyApiKey after selecting an account."
} else {
  $client = New-HttpClient
  try {
    $baseUrl = "http://127.0.0.1:$ProxyPort"
    $health = Invoke-BoundedHttpRequest -Client $client -Method "GET" -Url "$baseUrl/health"
    Add-Check "proxy.health" ($health.statusCode -eq 200 -and $health.bodyPreview -match '"status"\s*:\s*"ok"') $health

    $unauthorized = Invoke-BoundedHttpRequest `
      -Client $client `
      -Method "POST" `
      -Url "$baseUrl/v1/responses" `
      -Headers @{ "Content-Type" = "application/json" } `
      -Body '{"model":"gpt-5","input":"auth probe"}'
    Add-Check "proxy.rejectsMissingApiKey" ($unauthorized.statusCode -eq 401) $unauthorized

    $wrongApiKey = Invoke-BoundedHttpRequest `
      -Client $client `
      -Method "POST" `
      -Url "$baseUrl/v1/responses" `
      -Headers @{
        "Authorization" = "Bearer sk-local-wrong"
        "Content-Type" = "application/json"
      } `
      -Body '{"model":"gpt-5","input":"wrong api key probe"}'
    Add-Check "proxy.rejectsWrongApiKey" ($wrongApiKey.statusCode -eq 401) $wrongApiKey

    if ($ProbeProxyRoutes.IsPresent) {
      if ([string]::IsNullOrWhiteSpace($ProxyApiKey)) {
        Add-Check "proxy.routes" $false "Pass -ProxyApiKey when using -ProbeProxyRoutes."
      } else {
        $routes = Test-ProxyRoutes -Client $client -BaseUrl $baseUrl -ApiKey $ProxyApiKey
        $routesPassed = (
          $routes.models.statusCode -ge 200 -and $routes.models.statusCode -lt 300 -and
          $routes.chatCompletions.statusCode -ge 200 -and $routes.chatCompletions.statusCode -lt 300 -and
          $routes.responses.statusCode -ge 200 -and $routes.responses.statusCode -lt 300 -and
          $routes.responsesCompact.statusCode -ge 200 -and $routes.responsesCompact.statusCode -lt 300 -and
          $routes.memoriesTraceSummarize.statusCode -ge 200 -and $routes.memoriesTraceSummarize.statusCode -lt 300 -and
          $routes.alphaSearch.statusCode -ge 200 -and $routes.alphaSearch.statusCode -lt 300 -and
          $routes.messages.statusCode -ge 200 -and $routes.messages.statusCode -lt 300
        )
        Add-Check "proxy.routes" $routesPassed $routes
      }
    } else {
      Add-Check "proxy.routes" $false "Route probes were skipped. Add -ProbeProxyRoutes to verify /v1/models, /v1/chat/completions, /v1/responses, /v1/responses/compact, /v1/memories/trace_summarize, /v1/alpha/search, and /v1/messages."
    }
  } finally {
    $client.Dispose()
  }
}

$report = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  artifact = [ordered]@{
    runUrl = $ArtifactRunUrl
    digest = $ArtifactDigest
  }
  environment = [ordered]@{
    osVersion = [Environment]::OSVersion.VersionString
    processArchitecture = $env:PROCESSOR_ARCHITECTURE
    appDataSet = -not [string]::IsNullOrWhiteSpace($env:APPDATA)
    userProfileSet = -not [string]::IsNullOrWhiteSpace($env:USERPROFILE)
  }
  checks = $Checks
}

$outputDirectory = Split-Path -Parent $OutputPath
if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}
$report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputPath -Encoding UTF8

$failedChecks = @($Checks.GetEnumerator() | Where-Object { -not $_.Value.passed })
Write-Host "Windows verification report written to $OutputPath"
Write-Host "Checks passed: $($Checks.Count - $failedChecks.Count)/$($Checks.Count)"

if ($failedChecks.Count -gt 0) {
  Write-Host "Incomplete checks:"
  foreach ($check in $failedChecks) {
    Write-Host " - $($check.Key)"
  }
}

if ($RequireAutomated.IsPresent) {
  $failedAutomatedChecks = @($failedChecks | Where-Object { $_.Key -match "^(artifact|environment|automated|paths)\." })
  if ($failedAutomatedChecks.Count -gt 0) {
    exit 1
  }
}

if ($RequireComplete.IsPresent -and $failedChecks.Count -gt 0) {
  exit 1
}
