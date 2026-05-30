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
  }
} finally {
  Pop-Location
}
