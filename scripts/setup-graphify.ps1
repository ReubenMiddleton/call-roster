<#
.SYNOPSIS
  Installs a pinned Graphify into the gitignored .tools/ directory.

.DESCRIPTION
  Checkout-local by design. Every uv directory is redirected under .tools/, so this
  touches no machine state: not PATH, not the user's uv tool directory, not the user's
  Python installs. Deleting .tools/ undoes it completely.

  !! SOURCE VERIFICATION -- read before changing the package name.

  There are two namesquatting vectors on this project, so only three sources are
  legitimate:

    * Official site   graphify.com          (NOT graphify.net, a known impostor domain)
    * PyPI package    graphifyy             (note the DOUBLE "y")
    * GitHub          Graphify-Labs/graphify

  The project's own README warns that other `graphify*` packages on PyPI are unaffiliated.
  Verified 26 August 2026: PyPI `graphifyy` declares its Homepage and Repository as
  github.com/Graphify-Labs/graphify, which is Apache-2.0 and actively maintained. The two
  corroborate each other, which is the check worth doing -- a package claiming a repo it
  does not belong to is the thing to catch.

  Never install from a search result that does not match those three.

.NOTES
  Extraction runs in --code-only mode: deterministic local tree-sitter AST parsing, no
  API key, no network, nothing leaves the machine. See docs/GRAPHIFY.md.
#>

[CmdletBinding()]
param(
    [string]$Version = '0.9.50',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $repoRoot '.tools'
$uvExe    = Join-Path $toolsDir 'uv\uv.exe'

if (-not (Test-Path -LiteralPath $uvExe -PathType Leaf)) {
    throw "uv is not installed for this checkout. Run 'npm run setup:uv' first."
}

# Redirect every uv directory into .tools/ so nothing lands in the user profile.
$env:UV_TOOL_DIR           = Join-Path $toolsDir 'uv-tools'
$env:UV_TOOL_BIN_DIR       = Join-Path $toolsDir 'bin'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $toolsDir 'uv-python'
$env:UV_CACHE_DIR          = Join-Path $toolsDir 'uv-cache'

foreach ($dir in @($env:UV_TOOL_DIR, $env:UV_TOOL_BIN_DIR, $env:UV_PYTHON_INSTALL_DIR, $env:UV_CACHE_DIR)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

$graphifyExe = Join-Path $env:UV_TOOL_BIN_DIR 'graphify.exe'

$installed = if (Test-Path -LiteralPath $graphifyExe -PathType Leaf) {
    try { (& $graphifyExe --version 2>&1 | Select-Object -First 1).ToString().Trim() } catch { '' }
} else { '' }

if ($installed -match [regex]::Escape($Version) -and -not $Force) {
    Write-Output "Graphify $Version already present at .tools/bin/graphify.exe"
    exit 0
}

Write-Output "Installing graphifyy==$Version from PyPI (verified source -- see this script's header)"
& $uvExe tool install --force "graphifyy[mcp]==$Version"
if ($LASTEXITCODE -ne 0) { throw "uv tool install failed with exit code $LASTEXITCODE" }

if (-not (Test-Path -LiteralPath $graphifyExe -PathType Leaf)) {
    throw "Install reported success but graphify.exe is not at $graphifyExe"
}

Write-Output "Installed:"
& $graphifyExe --version
Write-Output ""
Write-Output "Next: npm run graph:update    (--code-only, local, no API key, no network)"
