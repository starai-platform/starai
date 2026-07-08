param(
  [switch]$Force,
  [switch]$DryRun,
  [switch]$KeepBuildCache
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $PSNativeCommandUseErrorActionPreference = $false
}

function Info($msg) { Write-Host ("[StarAI] " + $msg) -ForegroundColor Cyan }
function Warn($msg) { Write-Host ("[StarAI] " + $msg) -ForegroundColor Yellow }
function Fail($msg) {
  Write-Host ("[StarAI] " + $msg) -ForegroundColor Red
  exit 1
}

function Invoke-External([scriptblock]$Command, [string]$Label) {
  if ($DryRun) {
    Info "[DryRun] $Label"
    return 0
  }

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

function Get-EnvValue([string]$Content, [string]$Key) {
  $match = [regex]::Match($Content, "(?m)^\s*$([regex]::Escape($Key))\s*=\s*(.*?)\s*$")
  if (-not $match.Success) { return "" }
  return $match.Groups[1].Value.Trim().Trim('"').Trim("'")
}

function Assert-ChildPath([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($RootWithSlash, [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail "Refusing to remove path outside repo: $full"
  }
  return $full
}

function Remove-RepoPath([string]$RelativePath) {
  $target = Assert-ChildPath (Join-Path $Root $RelativePath)
  if (-not (Test-Path -LiteralPath $target)) {
    Info "Skip missing: $RelativePath"
    return
  }

  if ($DryRun) {
    Info "[DryRun] Remove: $target"
    return
  }

  Remove-Item -LiteralPath $target -Recurse -Force
  Info "Removed: $RelativePath"
}

function Stop-StarAIProcesses {
  $rootLower = $Root.ToLowerInvariant()
  $patterns = @(
    "go run ./cmd/api",
    "go run ./cmd/worker",
    "go run ./cmd/mock",
    "next dev",
    "pnpm dev"
  )

  try {
    $processes = Get-CimInstance Win32_Process -ErrorAction Stop |
      Where-Object {
        $cmd = if ($_.CommandLine) { $_.CommandLine.ToLowerInvariant() } else { "" }
        $_.CommandLine -and
        $_.ProcessId -ne $PID -and
        $cmd.Contains($rootLower) -and
        (($patterns | Where-Object { $cmd.Contains($_.ToLowerInvariant()) }).Count -gt 0)
      }

    foreach ($proc in $processes) {
      if ($DryRun) {
        Info "[DryRun] Stop process PID $($proc.ProcessId): $($proc.CommandLine)"
      } else {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
        Info "Stopped process PID $($proc.ProcessId)"
      }
    }
  } catch {
    Warn "Unable to inspect or stop local dev processes: $($_.Exception.Message)"
  }
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RootWithSlash = $Root.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
Set-Location $Root

Info "Repo: $Root"

if (-not (Test-Path (Join-Path $Root "pnpm-workspace.yaml")) -or -not (Test-Path (Join-Path $Root "infra/docker/docker-compose.yml"))) {
  Fail "This script must be run from the StarAI repo layout."
}

$envLocalPath = Join-Path $Root ".env.local"
if (-not (Test-Path $envLocalPath)) {
  Fail ".env.local is required for local cleanup guard. Create it first or restore it from the repo."
}

$envLocal = Get-Content -LiteralPath $envLocalPath -Raw -Encoding UTF8
$appEnv = Get-EnvValue $envLocal "APP_ENV"
$nodeEnv = Get-EnvValue $envLocal "NODE_ENV"
if ($appEnv -eq "production" -or $nodeEnv -eq "production") {
  Fail ".env.local looks like production (APP_ENV/NODE_ENV=production). Refusing to clean."
}

if (-not $Force -and -not $DryRun) {
  Warn "This will remove local development database/object-storage data and generated caches."
  Warn "It will NOT remove source code, .env.local, .env.example, node_modules, or git history."
  $answer = Read-Host "Type CLEAR_LOCAL_DEV_DATA to continue"
  if ($answer -ne "CLEAR_LOCAL_DEV_DATA") {
    Fail "Cancelled."
  }
}

Info "Stopping local StarAI dev processes"
Stop-StarAIProcesses

$composeFile = Join-Path $Root "infra/docker/docker-compose.yml"
if (Get-Command docker -ErrorAction SilentlyContinue) {
  $label = "docker compose -f `"$composeFile`" down -v --remove-orphans"
  $code = Invoke-External { docker compose -f $composeFile down -v --remove-orphans } $label
  if ($code -ne 0) {
    Warn "Docker compose cleanup failed. If Docker Desktop is not running, start it and rerun this script."
  }
} else {
  Warn "Docker CLI not found; skipping Docker containers and named volumes."
}

Info "Removing local generated data"
$paths = @(
  "data",
  "uploads",
  "uploads-local",
  "apps/web/public/uploads",
  "apps/web/public/uploads-local",
  "apps/admin/public/uploads",
  "apps/admin/public/uploads-local",
  ".turbo",
  ".cache",
  ".pytest_cache"
)

if (-not $KeepBuildCache) {
  $paths += @(
    "apps/web/.next",
    "apps/admin/.next",
    "apps/web/out",
    "apps/admin/out",
    "apps/web/dist",
    "apps/admin/dist",
    "apps/web/build",
    "apps/admin/build"
  )
}

foreach ($path in $paths) {
  Remove-RepoPath $path
}

Info "Local development data cleanup completed."
Info "Run scripts/dev.ps1 again to recreate containers, migrations, seed data, and local caches."
