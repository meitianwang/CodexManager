param(
  [ValidateSet("package", "make")]
  [string] $Target = "make",

  [ValidateSet("x64", "arm64")]
  [string] $Arch = "x64",

  [switch] $SkipInstall
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$WindowsApp = Join-Path $RepoRoot "apps/windows"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "pnpm is required. Install it with Corepack or npm before packaging."
}

Push-Location $WindowsApp
try {
  if (-not $SkipInstall -and -not (Test-Path "node_modules")) {
    pnpm install --frozen-lockfile
  }

  pnpm run typecheck
  pnpm test

  if ($Target -eq "package") {
    pnpm run package
  } else {
    pnpm run build
    pnpm exec electron-forge make --platform win32 --arch $Arch

    $MakeRoot = Join-Path $WindowsApp "out/make"
    $SquirrelOutput = Join-Path (Join-Path $MakeRoot "squirrel.windows") $Arch
    if (-not (Test-Path $SquirrelOutput)) {
      if (Test-Path (Join-Path $WindowsApp "out")) {
        Get-ChildItem -Path (Join-Path $WindowsApp "out") -Recurse | Select-Object -First 200 -ExpandProperty FullName
      }
      throw "Squirrel.Windows output directory was not created: $SquirrelOutput"
    }

    $SetupExe = Join-Path $SquirrelOutput "CodexManagerSetup.exe"
    $ReleasesFile = Join-Path $SquirrelOutput "RELEASES"
    $NugetPackages = @(Get-ChildItem -Path $SquirrelOutput -Filter "*.nupkg" -File)
    if (-not (Test-Path $SetupExe) -or -not (Test-Path $ReleasesFile) -or $NugetPackages.Count -eq 0) {
      Get-ChildItem -Path $SquirrelOutput -Recurse | Select-Object -First 200 -ExpandProperty FullName
      throw "Squirrel.Windows artifacts are incomplete in $SquirrelOutput"
    }
  }
} finally {
  Pop-Location
}
