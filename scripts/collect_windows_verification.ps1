param(
  [string] $OutputPath = "",

  [string] $ArtifactRunUrl = "",

  [string] $ArtifactDigest = "",

  [string] $ExpectedCurrentAccountId = "",

  [int] $ProxyPort = 0,

  [string] $ProxyApiKey = "",

  [switch] $ProbeProxyRoutes,

  [switch] $OAuthVerified,

  [switch] $SwitchVerified,

  [switch] $CodexLaunchVerified,

  [switch] $StartupVerified,

  [switch] $EditorRestartVerified,

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

Add-Check "manual.oauth" $OAuthVerified.IsPresent "Pass -OAuthVerified only after completing ChatGPT OAuth in the Windows app."
Add-Check "manual.switch" $SwitchVerified.IsPresent "Pass -SwitchVerified only after switching accounts and checking the active auth."
Add-Check "manual.codexLaunch" $CodexLaunchVerified.IsPresent "Pass -CodexLaunchVerified only after confirming Codex launches after account switch."
Add-Check "manual.startupRegistration" $StartupVerified.IsPresent "Pass -StartupVerified only after confirming Windows login item registration."
Add-Check "manual.editorRestart" $EditorRestartVerified.IsPresent "Pass -EditorRestartVerified only after confirming selected editors relaunch after account switch."

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
  Add-Check "proxy.routes" $false "Pass -ProbeProxyRoutes, -ProxyPort, and -ProxyApiKey after selecting an account."
} else {
  $client = New-HttpClient
  try {
    $baseUrl = "http://127.0.0.1:$ProxyPort"
    $health = Invoke-BoundedHttpRequest -Client $client -Method "GET" -Url "$baseUrl/health"
    Add-Check "proxy.health" ($health.statusCode -eq 200 -and $health.bodyPreview -match '"ok"\s*:\s*true') $health

    $unauthorized = Invoke-BoundedHttpRequest `
      -Client $client `
      -Method "POST" `
      -Url "$baseUrl/v1/responses" `
      -Headers @{ "Content-Type" = "application/json" } `
      -Body '{"model":"gpt-5","input":"auth probe"}'
    Add-Check "proxy.rejectsMissingApiKey" ($unauthorized.statusCode -eq 401) $unauthorized

    if ($ProbeProxyRoutes.IsPresent) {
      if ([string]::IsNullOrWhiteSpace($ProxyApiKey)) {
        Add-Check "proxy.routes" $false "Pass -ProxyApiKey when using -ProbeProxyRoutes."
      } else {
        $routes = Test-ProxyRoutes -Client $client -BaseUrl $baseUrl -ApiKey $ProxyApiKey
        $routesPassed = (
          $routes.chatCompletions.statusCode -ge 200 -and $routes.chatCompletions.statusCode -lt 300 -and
          $routes.responses.statusCode -ge 200 -and $routes.responses.statusCode -lt 300 -and
          $routes.messages.statusCode -ge 200 -and $routes.messages.statusCode -lt 300
        )
        Add-Check "proxy.routes" $routesPassed $routes
      }
    } else {
      Add-Check "proxy.routes" $false "Route probes were skipped. Add -ProbeProxyRoutes to verify /v1/chat/completions, /v1/responses, and /v1/messages."
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

if ($RequireComplete.IsPresent -and $failedChecks.Count -gt 0) {
  exit 1
}
