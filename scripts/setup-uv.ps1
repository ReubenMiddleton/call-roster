<#
.SYNOPSIS
  Installs a pinned, checksum-verified uv into the gitignored .tools/ directory.

.DESCRIPTION
  uv is the only viable Python route on this machine: `python` resolves to the Microsoft
  Store stub and there is no system pip. The solver (OR-Tools CP-SAT) is Python, so this
  is a hard dependency for anything under solver/.

  Checkout-local, no PATH change, pinned version -- the same pattern as gitleaks and
  Graphify. Verified against the release's published .sha256 before expanding.

  Known failure this script works around
  --------------------------------------
  uv can fail with "Missing expected target directory for Python minor version link".
  When that happens, pass an explicit interpreter instead of letting uv pick one:

      .tools/uv/uv.exe python list
      .tools/uv/uv.exe venv --python "$env:APPDATA\uv\python\cpython-3.12.13-windows-x86_64-none\python.exe"

  That interpreter already exists on this machine and ships a working pip, so it is also
  the fallback if uv itself misbehaves. Verified 26 Aug 2026: Python 3.12.13, pip 26.1.2.

.NOTES
  Bump $Version deliberately and record it in docs/DECISIONS.md.
#>

[CmdletBinding()]
param(
    [string]$Version = '0.12.6',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot  = Split-Path -Parent $PSScriptRoot
$toolsDir  = Join-Path $repoRoot '.tools'
$uvDir     = Join-Path $toolsDir 'uv'
$exePath   = Join-Path $uvDir 'uv.exe'
$stampPath = Join-Path $uvDir 'uv.version'

if ((Test-Path $exePath) -and (Test-Path $stampPath) -and -not $Force) {
    $installed = (Get-Content $stampPath -Raw).Trim()
    if ($installed -eq $Version) {
        Write-Output "uv $Version already present at .tools/uv/uv.exe"
        & $exePath --version
        exit 0
    }
    Write-Output "Replacing uv $installed with $Version"
}

$archiveName = 'uv-x86_64-pc-windows-msvc.zip'
$baseUrl     = "https://github.com/astral-sh/uv/releases/download/$Version"

New-Item -ItemType Directory -Force -Path $uvDir | Out-Null
$staging = Join-Path $toolsDir ".uv-staging-$Version"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

try {
    $archivePath  = Join-Path $staging $archiveName
    $checksumPath = "$archivePath.sha256"

    Write-Output "Downloading $archiveName ..."
    Invoke-WebRequest -Uri "$baseUrl/$archiveName" -OutFile $archivePath -UseBasicParsing
    Write-Output "Downloading $archiveName.sha256 ..."
    Invoke-WebRequest -Uri "$baseUrl/$archiveName.sha256" -OutFile $checksumPath -UseBasicParsing

    # astral-sh publishes "<sha256>  <filename>" in a per-asset .sha256 file.
    $expected = ((Get-Content $checksumPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actual   = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()

    if ($expected -ne $actual) {
        throw "Checksum mismatch for ${archiveName}: expected $expected, got $actual. Refusing to install."
    }
    Write-Output "Checksum verified: $actual"

    Expand-Archive -Path $archivePath -DestinationPath $staging -Force

    # The archive may place binaries at the root or inside a versioned folder.
    $found = Get-ChildItem -Path $staging -Filter 'uv.exe' -Recurse | Select-Object -First 1
    if (-not $found) { throw "uv.exe not found inside $archiveName" }

    Copy-Item -Path $found.FullName -Destination $exePath -Force
    foreach ($extra in @('uvx.exe', 'uvw.exe')) {
        $sidecar = Get-ChildItem -Path $staging -Filter $extra -Recurse | Select-Object -First 1
        if ($sidecar) { Copy-Item -Path $sidecar.FullName -Destination (Join-Path $uvDir $extra) -Force }
    }
    Set-Content -Path $stampPath -Value $Version -Encoding utf8 -NoNewline

    Write-Output "Installed to .tools/uv/uv.exe"
    & $exePath --version
}
finally {
    if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
}
