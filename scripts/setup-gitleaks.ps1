<#
.SYNOPSIS
  Installs a pinned, checksum-verified gitleaks into the gitignored .tools/ directory.

.DESCRIPTION
  Checkout-local by design, following Orbitarium's pattern: nothing is installed
  system-wide, nothing is added to PATH, and the version is pinned so the pre-commit
  hook behaves identically on every machine and in CI.

  The checksum is verified against the release's own published checksums.txt BEFORE the
  archive is expanded. A secret scanner is a security control; installing one from an
  unverified download would be self-defeating.

  Re-running is safe and cheap: if the pinned version is already present it exits early.

.NOTES
  Bump $Version deliberately and record it in docs/DECISIONS.md. Dependabot does not
  watch this file.
#>

[CmdletBinding()]
param(
    [string]$Version = '8.30.1',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $repoRoot '.tools'
$exePath  = Join-Path $toolsDir 'gitleaks.exe'
$stampPath = Join-Path $toolsDir 'gitleaks.version'

if ((Test-Path $exePath) -and (Test-Path $stampPath) -and -not $Force) {
    $installed = (Get-Content $stampPath -Raw).Trim()
    if ($installed -eq $Version) {
        Write-Output "gitleaks $Version already present at .tools/gitleaks.exe"
        & $exePath version
        exit 0
    }
    Write-Output "Replacing gitleaks $installed with $Version"
}

# x64 only: this project's machine notes record a single Windows x64 dev machine, and CI
# runs ubuntu-latest where the workflow uses the gitleaks action instead of this script.
$archiveName  = "gitleaks_${Version}_windows_x64.zip"
$checksumName = "gitleaks_${Version}_checksums.txt"
$baseUrl      = "https://github.com/gitleaks/gitleaks/releases/download/v$Version"

New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$staging = Join-Path $toolsDir ".gitleaks-staging-$Version"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

try {
    $archivePath  = Join-Path $staging $archiveName
    $checksumPath = Join-Path $staging $checksumName

    Write-Output "Downloading $archiveName ..."
    Invoke-WebRequest -Uri "$baseUrl/$archiveName" -OutFile $archivePath -UseBasicParsing
    Write-Output "Downloading $checksumName ..."
    Invoke-WebRequest -Uri "$baseUrl/$checksumName" -OutFile $checksumPath -UseBasicParsing

    # The checksums file is "<sha256>  <filename>" per line.
    $expectedLine = Get-Content $checksumPath | Where-Object { $_ -match [regex]::Escape($archiveName) } | Select-Object -First 1
    if (-not $expectedLine) {
        throw "No checksum entry for $archiveName in $checksumName. Refusing to install."
    }
    $expected = ($expectedLine -split '\s+')[0].ToLowerInvariant()
    $actual   = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()

    if ($expected -ne $actual) {
        throw "Checksum mismatch for ${archiveName}: expected $expected, got $actual. Refusing to install."
    }
    Write-Output "Checksum verified: $actual"

    Expand-Archive -Path $archivePath -DestinationPath $staging -Force
    $extracted = Join-Path $staging 'gitleaks.exe'
    if (-not (Test-Path $extracted)) { throw "gitleaks.exe not found inside $archiveName" }

    Move-Item -Path $extracted -Destination $exePath -Force
    Set-Content -Path $stampPath -Value $Version -Encoding utf8 -NoNewline

    Write-Output "Installed to .tools/gitleaks.exe"
    & $exePath version
}
finally {
    if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
}
