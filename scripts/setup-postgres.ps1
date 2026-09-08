<#
.SYNOPSIS
  Installs a pinned PostgreSQL client+server and the Supabase CLI into the gitignored .tools/.

.DESCRIPTION
  Closes the gap HANDOFF.md has warned about since the schema work started:

      "No Docker and no Postgres client here -- docker, psql, pg_ctl all absent. Migrations
       can be *authored* but nothing can *run* them, and unverified SQL claiming a working
       exclusion constraint looks done and is not."

  That gap matters more here than in most projects, because the two invariants this product
  leans on hardest live in the database and cannot be checked by reading them:

      * a GiST exclusion constraint making double-booking impossible
      * temporal foreign keys for membership containment

  WHY NOT DOCKER
  --------------
  Docker Desktop needs administrator rights, WSL2 or Hyper-V, ~2 GB, a background VM and
  usually a reboot. None of that can be done from a script here, and none of it is needed:
  the EnterpriseDB *binaries* zip is an ordinary archive containing initdb, pg_ctl, postgres
  and psql, and a cluster can be created and started from a directory with no installer, no
  service registration and no admin rights. It also ships contrib, so btree_gist -- which
  the exclusion constraint requires -- is present.

  Docker remains the right answer for reproducing the hosted stack end to end (auth, storage,
  the API gateway) via `supabase start`. This script deliberately does not attempt it, and
  says so rather than half-installing something.

  Checkout-local, no PATH change, pinned versions, the same pattern as setup-uv.ps1 and
  setup-gitleaks.ps1. Nothing here depends on machine PATH.

.NOTES
  Bump the versions deliberately and record it in docs/DECISIONS.md.
  PostgreSQL 17 is chosen to match what Supabase runs.
#>

[CmdletBinding()]
param(
    [string]$PostgresVersion = '17.2-1',
    [string]$SupabaseVersion = '2.117.0',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $repoRoot '.tools'
$pgDir    = Join-Path $toolsDir 'pgsql'
$sbDir    = Join-Path $toolsDir 'supabase'

New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("crsetup-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null

function Save-Url {
    param([string]$Url, [string]$Destination)
    # -UseBasicParsing: the IE-engine parser prompts on first use, and this session is
    # non-interactive, which surfaces as a baffling "Read and Prompt functionality is not
    # available" from what looks like a plain download.
    $previous = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -MaximumRedirection 5
    } finally {
        $ProgressPreference = $previous
    }
}

try {
    # ── PostgreSQL binaries ──────────────────────────────────────────────────────────
    $pgExe = Join-Path $pgDir 'bin\psql.exe'
    if ((Test-Path $pgExe) -and -not $Force) {
        Write-Output "PostgreSQL already present: $pgExe"
    } else {
        $pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-$PostgresVersion-windows-x64-binaries.zip"
        $pgZip = Join-Path $temp 'postgresql.zip'
        Write-Output "Downloading PostgreSQL $PostgresVersion (~297 MB)..."
        Save-Url -Url $pgUrl -Destination $pgZip

        # EnterpriseDB publishes no checksum file, so the hash is RECORDED on first install
        # and verified on every later one -- a lockfile, not a trust decision. gitleaks and
        # uv verify against a published .sha256 instead; that is strictly better and is used
        # wherever the vendor provides one.
        $hash = (Get-FileHash -Path $pgZip -Algorithm SHA256).Hash.ToLowerInvariant()
        $lock = Join-Path $toolsDir 'pgsql.version'
        if (Test-Path $lock) {
            $expected = (Get-Content $lock -Raw).Trim() -split '\s+' | Select-Object -Last 1
            if ($expected -ne $hash) {
                throw "PostgreSQL archive hash changed: expected $expected, got $hash. Refusing to install."
            }
            Write-Output "Checksum matches the recorded pin: $hash"
        } else {
            Write-Output "Recording first-install pin: $hash"
        }

        if (Test-Path $pgDir) { Remove-Item -Recurse -Force $pgDir }
        Write-Output 'Expanding...'
        Expand-Archive -Path $pgZip -DestinationPath $temp -Force
        Move-Item -Path (Join-Path $temp 'pgsql') -Destination $pgDir
        Set-Content -Path $lock -Value "$PostgresVersion $hash" -Encoding utf8 -NoNewline
    }

    # ── Supabase CLI ─────────────────────────────────────────────────────────────────
    $sbExe = Join-Path $sbDir 'supabase.exe'
    if ((Test-Path $sbExe) -and -not $Force) {
        Write-Output "Supabase CLI already present: $sbExe"
    } else {
        $base    = "https://github.com/supabase/cli/releases/download/v$SupabaseVersion"
        $archive = "supabase_${SupabaseVersion}_windows_amd64.zip"
        $sbZip   = Join-Path $temp $archive
        $sumFile = Join-Path $temp 'checksums.txt'
        Write-Output "Downloading Supabase CLI $SupabaseVersion (~54 MB)..."
        Save-Url -Url "$base/$archive" -Destination $sbZip
        Save-Url -Url "$base/checksums.txt" -Destination $sumFile

        # The checksums file is "<sha256>  <filename>" per line -- same shape as gitleaks.
        $line = Get-Content $sumFile | Where-Object { $_ -match [regex]::Escape($archive) } | Select-Object -First 1
        if (-not $line) { throw "No checksum line for $archive. Refusing to install." }
        $expected = ($line -split '\s+')[0].ToLowerInvariant()
        $actual   = (Get-FileHash -Path $sbZip -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($expected -ne $actual) {
            throw "Checksum mismatch for ${archive}: expected $expected, got $actual. Refusing to install."
        }
        Write-Output "Checksum verified: $actual"

        if (Test-Path $sbDir) { Remove-Item -Recurse -Force $sbDir }
        Expand-Archive -Path $sbZip -DestinationPath $sbDir -Force
        Set-Content -Path (Join-Path $toolsDir 'supabase.version') -Value $SupabaseVersion -Encoding utf8 -NoNewline
    }

    Write-Output ''
    Write-Output 'Installed, checkout-local, nothing added to PATH:'
    & $pgExe --version
    & $sbExe --version
}
finally {
    if (Test-Path $temp) { Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue }
}
