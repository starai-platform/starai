param(
  [string]$EnvFile = ".env",
  [string]$ComposeFile = "infra/docker/docker-compose.yml",
  [string]$OutDir = "backups/settings",
  [switch]$IncludeAdminAccounts
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Read-EnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path $Path)) { return "" }
  $line = Get-Content -LiteralPath $Path -Encoding UTF8 | Where-Object { $_ -match "^\s*$([regex]::Escape($Key))\s*=" } | Select-Object -First 1
  if (-not $line) { return "" }
  $value = $line -replace "^\s*[^=]+\s*=", ""
  $value = $value.Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  return $value
}

if (-not (Test-Path $ComposeFile)) {
  throw "Compose file not found: $ComposeFile"
}

$dbUser = Read-EnvValue -Path $EnvFile -Key "POSTGRES_USER"
$dbName = Read-EnvValue -Path $EnvFile -Key "POSTGRES_DB"
if (-not $dbUser) { $dbUser = "starai" }
if (-not $dbName) { $dbName = "starai" }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) "starai-settings-$stamp"
$sqlFile = Join-Path $workDir "settings.sql"
$metaFile = Join-Path $workDir "README.txt"
$archive = Join-Path $OutDir "starai-settings-$stamp.tar.gz"
$archiveForShell = $archive -replace "\\", "/"
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

$tables = @(
  "system_configs",
  "models",
  "model_channel_presets",
  "role_templates",
  "workflow_definitions",
  "home_cards",
  "gallery_tags",
  "api_docs",
  "member_levels",
  "announcements"
)

if ($IncludeAdminAccounts) {
  $tables = @("admin_roles", "admin_users") + $tables
}

$truncateLines = @(
  "-- StarAI settings pack",
  "-- Created at: $((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))",
  "-- Source env: $EnvFile",
  "--",
  "-- This pack contains platform configuration only.",
  "-- It intentionally excludes users, wallets, orders, tasks, works, assets, withdrawals and logs.",
  "-- Import only into a clean local/new-server database unless you have a backup.",
  "BEGIN;",
  "TRUNCATE TABLE"
)

if ($IncludeAdminAccounts) {
  $truncateLines += "  public.admin_operation_logs,"
  $truncateLines += "  public.admin_users,"
  $truncateLines += "  public.admin_roles,"
}

$truncateLines += @(
  "  public.api_docs,",
  "  public.workflow_definitions,",
  "  public.model_channel_presets,",
  "  public.role_templates,",
  "  public.home_cards,",
  "  public.gallery_tags,",
  "  public.member_levels,",
  "  public.announcements,",
  "  public.models,",
  "  public.system_configs",
  "RESTART IDENTITY CASCADE;"
)

Set-Content -LiteralPath $sqlFile -Value ($truncateLines -join "`n") -Encoding UTF8
Add-Content -LiteralPath $sqlFile -Value "" -Encoding UTF8

Write-Host "==> Checking compose config"
docker compose -f $ComposeFile config | Out-Null

Write-Host "==> Starting PostgreSQL"
docker compose -f $ComposeFile up -d postgres | Out-Null

$tableArgs = @()
foreach ($table in $tables) {
  $tableArgs += "--table=public.$table"
}

Write-Host "==> Exporting settings tables from postgres/$dbName"
$dump = docker compose -f $ComposeFile exec -T postgres pg_dump -U $dbUser -d $dbName `
  --data-only `
  --column-inserts `
  --disable-triggers `
  --no-owner `
  --no-privileges `
  @tableArgs
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed"
}
Add-Content -LiteralPath $sqlFile -Value $dump -Encoding UTF8
Add-Content -LiteralPath $sqlFile -Value "COMMIT;" -Encoding UTF8

$meta = @(
  "StarAI settings pack",
  "",
  "Created: $((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))",
  "Database: $dbName",
  "Included tables:"
)
foreach ($table in $tables) {
  $meta += "- $table"
}
$meta += @(
  "",
  "Excluded by design:",
  "- users, auth_identities, wallets, wallet_transactions, cash_transactions",
  "- orders, recharge cards, withdrawals, tasks, works, assets, conversations",
  "- gallery_items and admin_operation_logs",
  "",
  "Security note:",
  "- system_configs may contain production keys, storage secrets, SMTP/OAuth settings, and API tokens.",
  "- Do not commit this archive to GitHub. Store it in a private backup location.",
  "",
  "Import on server:",
  "  IMPORT_SETTINGS_PACK=1 SETTINGS_PACK=$archiveForShell bash scripts/deploy-prod.sh"
)
Set-Content -LiteralPath $metaFile -Value ($meta -join "`n") -Encoding UTF8

tar -czf $archive -C $workDir settings.sql README.txt
if ($LASTEXITCODE -ne 0) {
  throw "tar failed"
}

Remove-Item -Recurse -Force $workDir
Write-Host "Settings pack created: $archive"
Write-Host "Do not commit this archive to GitHub."
