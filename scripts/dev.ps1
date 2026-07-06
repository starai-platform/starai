$ErrorActionPreference = "Stop"
# PowerShell 7+: do not treat native stderr (docker/go) as terminating errors.
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $PSNativeCommandUseErrorActionPreference = $false
}

function Info($msg) { Write-Host ("[StarAI] " + $msg) -ForegroundColor Cyan }
function Warn($msg) { Write-Host ("[StarAI] " + $msg) -ForegroundColor Yellow }
function Fail($msg) {
  Write-Host ("[StarAI] " + $msg) -ForegroundColor Red
  exit 1
}

# Docker / go / pnpm often write progress to stderr; with $ErrorActionPreference=Stop that looks like a fatal error.
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

function Test-PortListening([int]$Port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(400)
    $client.Close()
    return $ok
  } catch {
    return $false
  }
}

function Wait-HttpOk([string]$Url, [int]$Retries = 30, [int]$DelayMs = 1000) {
  for ($i = 0; $i -lt $Retries; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { return $true }
    } catch {
      # keep waiting
    }
    Start-Sleep -Milliseconds $DelayMs
  }
  return $false
}

function Test-ServiceHealthy([string]$Name, [int]$Port, [string]$Url) {
  if (-not (Test-PortListening $Port)) {
    return $false
  }
  return Wait-HttpOk -Url $Url -Retries 2 -DelayMs 400
}

function Stop-StarAIFrontendProcesses([string]$AppDirName) {
  $targetDir = (Join-Path $Root "apps/$AppDirName").ToLowerInvariant()
  $stopped = $false
  try {
    $candidates = Get-CimInstance Win32_Process -ErrorAction Stop |
      Where-Object {
        $_.CommandLine -and
        $_.ProcessId -ne $PID -and
        $_.Name -match "^(node|pnpm|powershell|pwsh)(\.exe)?$" -and
        $_.CommandLine.ToLowerInvariant().Contains($targetDir) -and
        (
          $_.CommandLine -match "next\s+dev" -or
          $_.CommandLine -match "pnpm(\.cmd)?\s+dev"
        )
      }
    foreach ($proc in $candidates) {
      try {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
        Info "Stopped stale $AppDirName dev process PID $($proc.ProcessId)"
        $stopped = $true
      } catch {
        Warn "Failed to stop stale $AppDirName process PID $($proc.ProcessId): $($_.Exception.Message)"
      }
    }
  } catch {
    Warn "Unable to inspect stale $AppDirName dev processes: $($_.Exception.Message)"
  }
  return $stopped
}

function Start-StarAIServiceWindow([string]$Title, [string]$WorkingDir, [string]$Command) {
  $goproxy = if ($env:GOPROXY) { $env:GOPROXY } else { "https://goproxy.cn,direct" }
  $inner = "`$env:GOPROXY='$goproxy'; Set-Location '$WorkingDir'; $Command"
  Start-Process powershell -WorkingDirectory $WorkingDir -ArgumentList "-NoExit","-Command",$inner
  Info "Launched $Title"
}

$BackendOnly = $false
if ($args -contains "-BackendOnly") { $BackendOnly = $true }

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

Info "Repo: $Root"

# Go module proxy: default proxy.golang.org is often unreachable in CN networks.
if (-not $env:GOPROXY) {
  $env:GOPROXY = "https://goproxy.cn,direct"
  Info "GOPROXY not set; using $env:GOPROXY"
}

# 0) Ensure .env exists
if (-not (Test-Path (Join-Path $Root ".env"))) {
  Info "Creating .env from .env.local"
  Copy-Item (Join-Path $Root ".env.local") (Join-Path $Root ".env")
} else {
  Info ".env exists"
}

# 1) Start infra (Postgres/Redis/MinIO)
Info "Starting Docker infrastructure"
if ((Invoke-External { docker version }) -ne 0) {
  Fail "Docker CLI not available. Please install/start Docker Desktop first."
}

# Docker context on Windows can be wrong (desktop-linux pipe missing). Ensure we use default engine.
try {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $ctx = (docker context show 2>$null).Trim()
  $ErrorActionPreference = $prev
  if ($ctx -and $ctx -ne "default") {
    Warn "Docker context is '$ctx' (switching to 'default')"
    Invoke-External { docker context use default } | Out-Null
  }
} catch {
  # ignore
}

$composeFile = Join-Path $Root "infra/docker/docker-compose.yml"
if ((Invoke-External { docker compose -f $composeFile up -d postgres redis minio }) -ne 0) {
  Fail "Docker compose failed. Make sure Docker Desktop is running and can pull images, then re-run this script."
}

# wait for postgres port
Info "Waiting for Postgres on localhost:5432"
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect("127.0.0.1", 5432, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(500)
    $client.Close()
  } catch {
    $ok = $false
  }
  if ($ok) { break }
  Start-Sleep -Milliseconds 500
}
if (-not $ok) {
  Fail "Postgres is not reachable on 127.0.0.1:5432. If Docker just started, wait a bit and retry."
}

# 2) Download Go deps + run migrations (seeds data)
Info "Downloading Go modules (api / worker / mock-new-api)"
foreach ($svc in @("api", "worker", "mock-new-api")) {
  Push-Location (Join-Path $Root "services/$svc")
  if ((Invoke-External { go mod download }) -ne 0) {
    Pop-Location
    Fail "Go module download failed for services/$svc. Check network or set GOPROXY (e.g. https://goproxy.cn,direct)."
  }
  Pop-Location
}

Info "Running DB migrations"
Push-Location (Join-Path $Root "services/api")
if ((Invoke-External { go run ./cmd/migrate up }) -ne 0) {
  Pop-Location
  Fail "DB migrations failed. If Docker/Postgres is healthy, verify DATABASE_URL in .env (default: postgres://starai:starai@localhost:5432/starai?sslmode=disable)."
}
Pop-Location

# 3) Install JS deps (best effort)
if ($BackendOnly) {
  Info "BackendOnly enabled: skip pnpm install / web/admin"
  Info "Launching backend services (new windows)"
  Start-StarAIServiceWindow "Mock NEW API (:3002)" (Join-Path $Root "services/mock-new-api") "go run ./cmd/mock"
  Start-StarAIServiceWindow "API (:8080)" (Join-Path $Root "services/api") "go run ./cmd/api"
  Start-StarAIServiceWindow "Worker" (Join-Path $Root "services/worker") "go run ./cmd/worker"
  Info "Done."
  Info "API:   http://localhost:8080"
  Info "Mock:  http://localhost:3002"
  Info "MinIO: http://localhost:9001"
  exit 0
}

# Ensure pnpm is available (Node 20+ ships corepack).
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Info "pnpm not found; enabling via corepack"
  corepack enable | Out-Null
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Fail "pnpm is not installed. Run: corepack enable && corepack prepare pnpm@latest --activate"
  }
}

Info "Installing pnpm deps"
$env:CI = "true"
if ((Invoke-External { pnpm install }) -ne 0) {
  Warn "pnpm install failed (exit $LASTEXITCODE). If EPERM on Windows: close dev servers/IDE locks, then run: Remove-Item -Recurse -Force node_modules; pnpm install"
  Fail "pnpm install failed."
}

# 4) Start long-running services in separate PowerShell windows
Info "Launching services (new windows - do not close them while developing)"
$servicePorts = @{
  "Mock NEW API" = 3002
  "API"          = 8080
  "Web"          = 3000
  "Admin"        = 3001
}
$serviceHealth = @{
  "Mock NEW API" = "http://localhost:3002"
  "API"          = "http://localhost:8080/health"
  "Web"          = "http://localhost:3000"
  "Admin"        = "http://localhost:3001"
}
foreach ($name in $servicePorts.Keys) {
  $port = $servicePorts[$name]
  $url = $serviceHealth[$name]
  if (Test-PortListening $port) {
    if ($url -and (Test-ServiceHealthy -Name $name -Port $port -Url $url)) {
      Warn "$name port $port already in use - reusing existing healthy process"
    } else {
      Warn "$name port $port is occupied, but $url is not healthy yet"
      if ($name -eq "Web") {
        if (Stop-StarAIFrontendProcesses -AppDirName "web") {
          Start-Sleep -Milliseconds 800
        } else {
          Warn "Could not auto-stop the stale Web process; close the old web dev window if port 3000 stays occupied"
        }
      } elseif ($name -eq "Admin") {
        if (Stop-StarAIFrontendProcesses -AppDirName "admin") {
          Start-Sleep -Milliseconds 800
        } else {
          Warn "Could not auto-stop the stale Admin process; close the old admin dev window if port 3001 stays occupied"
        }
      } else {
        Warn "You may need to stop the stale process first"
      }
    }
  }
}

if (-not (Test-PortListening 3002)) {
  Start-StarAIServiceWindow "Mock NEW API (:3002)" (Join-Path $Root "services/mock-new-api") "go run ./cmd/mock"
}
if (-not (Test-PortListening 8080)) {
  Start-StarAIServiceWindow "API (:8080)" (Join-Path $Root "services/api") "go run ./cmd/api"
}
Start-StarAIServiceWindow "Worker" (Join-Path $Root "services/worker") "go run ./cmd/worker"
if (-not (Test-PortListening 3000)) {
  Start-StarAIServiceWindow "Web (:3000)" (Join-Path $Root "apps/web") "if (Test-Path '.next') { Remove-Item -Recurse -Force '.next' -ErrorAction SilentlyContinue }; pnpm dev"
}
if (-not (Test-PortListening 3001)) {
  Start-StarAIServiceWindow "Admin (:3001)" (Join-Path $Root "apps/admin") "if (Test-Path '.next') { Remove-Item -Recurse -Force '.next' -ErrorAction SilentlyContinue }; pnpm dev"
}

Info "Waiting for services to become reachable..."
$checks = @(
  @{ Name = "Web";   Url = "http://localhost:3000" },
  @{ Name = "Admin"; Url = "http://localhost:3001" },
  @{ Name = "API";   Url = "http://localhost:8080/health" }
)
foreach ($c in $checks) {
  if (Wait-HttpOk $c.Url) {
    Info "$($c.Name) ready: $($c.Url)"
  } else {
    Warn "$($c.Name) not reachable yet: $($c.Url) - check the popup PowerShell window for errors"
  }
}

Info "Done."
Info "Web:   http://localhost:3000"
Info "Admin: http://localhost:3001"
Info "API:   http://localhost:8080"
Info "Mock:  http://localhost:3002"
Info "MinIO: http://localhost:9001"
