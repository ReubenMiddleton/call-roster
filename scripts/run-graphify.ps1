<#
.SYNOPSIS
  Runs the checkout-local Graphify, forwarding all arguments.

.DESCRIPTION
  Wraps every invocation so nothing depends on machine PATH. Exposed through npm as
  graph:update, graph:query and graph:benchmark.

  Fails with an actionable message rather than a confusing one when Graphify is not
  installed, because .tools/ is gitignored -- a fresh clone always needs graph:setup.
#>

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$GraphifyArguments
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot    = Split-Path -Parent $PSScriptRoot
$toolsDir    = Join-Path $repoRoot '.tools'
$graphifyExe = Join-Path $toolsDir 'bin\graphify.exe'

if (-not (Test-Path -LiteralPath $graphifyExe -PathType Leaf)) {
    throw "Graphify is not installed for this checkout. Run 'npm run graph:setup' first. (.tools/ is gitignored, so a fresh clone always needs this.)"
}

# Keep uv's directories pointed into .tools/ for any subprocess Graphify spawns.
$env:UV_TOOL_DIR           = Join-Path $toolsDir 'uv-tools'
$env:UV_TOOL_BIN_DIR       = Join-Path $toolsDir 'bin'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $toolsDir 'uv-python'
$env:UV_CACHE_DIR          = Join-Path $toolsDir 'uv-cache'

& $graphifyExe @GraphifyArguments
exit $LASTEXITCODE
