param(
  [ValidateSet("package", "make")]
  [string] $Target = "make",

  [ValidateSet("x64", "arm64")]
  [string] $Arch = "x64",

  [switch] $SkipInstall
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DesktopApp = Join-Path $RepoRoot "apps/desktop"

function Write-LimitedTree {
  param(
    [string] $Path
  )

  if (Test-Path $Path) {
    Get-ChildItem -Path $Path -Recurse | Select-Object -First 200 -ExpandProperty FullName
  }
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "pnpm is required. Install it with Corepack or npm before packaging."
}

Push-Location $DesktopApp
try {
  if (-not $SkipInstall -and -not (Test-Path "node_modules")) {
    pnpm install --frozen-lockfile
  }

  pnpm run typecheck
  pnpm test
  pnpm run verify:package-assets

  pnpm run build

  pnpm exec electron-forge package --platform win32 --arch $Arch
  $PackageOutput = Join-Path $DesktopApp "out/CodexManager-win32-$Arch"
  $PackageExe = Join-Path $PackageOutput "CodexManager.exe"
  $PackageDeadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Path $PackageExe) -and (Get-Date) -lt $PackageDeadline) {
    Start-Sleep -Seconds 1
  }
  if (-not (Test-Path $PackageExe)) {
    Write-LimitedTree -Path (Join-Path $DesktopApp "out")
    throw "Packaged Windows release was not created: $PackageExe"
  }

  if ($Target -eq "make") {
    pnpm exec electron-forge make --skip-package --targets squirrel --platform win32 --arch $Arch

    $MakeRoot = Join-Path $DesktopApp "out/make"
    $SquirrelOutput = Join-Path (Join-Path $MakeRoot "squirrel.windows") $Arch
    if (-not (Test-Path $SquirrelOutput)) {
      Write-LimitedTree -Path (Join-Path $DesktopApp "out")
      throw "Squirrel.Windows output directory was not created: $SquirrelOutput"
    }

    $SetupExe = Join-Path $SquirrelOutput "CodexManagerSetup.exe"
    $ReleasesFile = Join-Path $SquirrelOutput "RELEASES"
    $NugetPackages = @(Get-ChildItem -Path $SquirrelOutput -Filter "*.nupkg" -File)
    if (-not (Test-Path $SetupExe) -or -not (Test-Path $ReleasesFile) -or $NugetPackages.Count -eq 0) {
      Write-LimitedTree -Path $SquirrelOutput
      throw "Squirrel.Windows artifacts are incomplete in $SquirrelOutput"
    }
  }
} finally {
  Pop-Location
}
