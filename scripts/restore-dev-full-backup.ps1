param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,

  [switch]$ConfirmRestore
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $PSNativeCommandUseErrorActionPreference = $false
}

function Info($msg) { Write-Host ("[StarAI Restore] " + $msg) -ForegroundColor Cyan }
function Warn($msg) { Write-Host ("[StarAI Restore] " + $msg) -ForegroundColor Yellow }
function Fail($msg) {
  Write-Host ("[StarAI Restore] " + $msg) -ForegroundColor Red
  exit 1
}

function Invoke-External([scriptblock]$Command) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $Command 2>&1
    foreach ($line in $output) {
      if ($line -is [System.Management.Automation.ErrorRecord]) {
        Write-Host $line.ToString()
      } else {
        Write-Host $line
      }
    }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
}

if (-not $ConfirmRestore) {
  Fail "This will delete local StarAI Docker volumes and restore the backup. Re-run with -ConfirmRestore."
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

$BackupFullPath = (Resolve-Path $BackupPath).Path
$ComposeFile = Join-Path $Root "infra/docker/docker-compose.yml"
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("starai-restore-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TempDir | Out-Null

try {
  Info "Backup: $BackupFullPath"
  Warn "Close local StarAI dev windows first if API/Worker/Web/Admin are still running."

  $DumpFile = $BackupFullPath
  $UploadsArchive = $null

  if ($BackupFullPath -match "\.(tar\.gz|tgz)$") {
    Info "Extracting full backup archive"
    if ((Invoke-External { tar -xzf $BackupFullPath -C $TempDir }) -ne 0) {
      Fail "Failed to extract backup archive."
    }
    $DumpFile = Join-Path $TempDir "starai-full.dump"
    $UploadsArchive = Join-Path $TempDir "uploads.tar.gz"
    if (-not (Test-Path $DumpFile)) {
      Fail "starai-full.dump not found in backup archive."
    }
  } elseif ($BackupFullPath -notmatch "\.dump$") {
    Warn "Backup file is not a .dump or .tar.gz; trying to restore it as a pg_restore custom dump."
  }

  Info "Removing local StarAI Docker containers and volumes"
  if ((Invoke-External { docker compose -f $ComposeFile down -v --remove-orphans }) -ne 0) {
    Fail "docker compose down failed."
  }

  Info "Starting local Postgres/Redis/MinIO"
  if ((Invoke-External { docker compose -f $ComposeFile up -d postgres redis minio }) -ne 0) {
    Fail "Failed to start local Docker infrastructure."
  }

  Info "Waiting for local Postgres"
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    $code = Invoke-External { docker compose -f $ComposeFile exec -T postgres pg_isready -U starai -d starai }
    if ($code -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    Fail "Postgres did not become ready."
  }

  if ($UploadsArchive -and (Test-Path $UploadsArchive)) {
    Info "Restoring uploads to data/uploads"
    $DataDir = Join-Path $Root "data"
    $UploadsDir = Join-Path $Root "data/uploads"
    if (Test-Path $UploadsDir) {
      Remove-Item -LiteralPath $UploadsDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    if ((Invoke-External { tar -xzf $UploadsArchive -C $DataDir }) -ne 0) {
      Fail "Failed to restore uploads archive."
    }
  } else {
    Warn "No uploads.tar.gz found; database will be restored without local upload files."
  }

  Info "Restoring database dump"
  $RestoreCommand = 'docker compose -f "' + $ComposeFile + '" exec -T postgres pg_restore -U starai -d starai --clean --if-exists --no-owner --no-privileges < "' + $DumpFile + '"'
  if ((Invoke-External { cmd /c $RestoreCommand }) -ne 0) {
    Fail "Database restore failed."
  }

  Info "Restore finished."
  Info "Start local dev again:"
  Info "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1"
} finally {
  if (Test-Path $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
