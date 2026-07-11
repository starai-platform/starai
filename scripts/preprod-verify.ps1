param(
    [switch]$KeepRunning,
    [switch]$SkipBuild,
    [switch]$PreserveData
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ComposeFile = Join-Path $Root "infra/docker/docker-compose.prod.yml"
$Template = Join-Path $Root ".env.preprod.example"
$EnvFile = Join-Path $Root ".env.preprod"
$Project = "starai-preprod"

function Step([string]$Message) { Write-Host "[preprod] $Message" -ForegroundColor Cyan }
function Compose([string[]]$Arguments) {
    & docker compose --project-name $Project --env-file $EnvFile -f $ComposeFile @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed: $($Arguments -join ' ')" }
}
function Wait-Healthy([string]$Service, [int]$Retries = 60) {
    for ($i = 0; $i -lt $Retries; $i++) {
        $id = (& docker compose --project-name $Project --env-file $EnvFile -f $ComposeFile ps -q $Service).Trim()
        if ($id) {
            $status = (& docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $id).Trim()
            if ($status -in @("healthy", "running")) { return }
            if ($status -in @("unhealthy", "exited", "dead")) { break }
        }
        Start-Sleep -Seconds 2
    }
    Compose @("logs", "--tail=100", $Service)
    throw "$Service did not become healthy"
}

Set-Location $Root
# Some Docker Desktop installations export this daemon-side option into the
# client environment. The CLI prints a warning to stderr and Windows
# PowerShell 5 treats it as a terminating NativeCommandError under Stop.
Remove-Item Env:DOCKER_INSECURE_NO_IPTABLES_RAW -ErrorAction SilentlyContinue
if (-not (Test-Path $EnvFile)) {
    Copy-Item $Template $EnvFile
    Step "Created isolated .env.preprod from template"
}

Step "Checking Docker daemon"
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& docker info *> $null
$dockerInfoExit = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction
if ($dockerInfoExit -ne 0) { throw "Docker Desktop/Engine is not running" }

try {
    Step "Validating Compose configuration"
    Compose @("config", "--quiet")

    if (-not $PreserveData) {
        Step "Resetting isolated pre-production data"
        Compose @("--profile", "preprod", "--profile", "tools", "down", "-v", "--remove-orphans")
    }

    Step "Starting isolated PostgreSQL and Redis"
    Compose @("--profile", "preprod", "up", "-d", "postgres", "redis", "mock-new-api")
    Wait-Healthy "postgres"
    Wait-Healthy "redis"
    Wait-Healthy "mock-new-api"

    if (-not $SkipBuild) {
        foreach ($service in @("api", "worker", "web", "admin", "mock-new-api")) {
            Step "Building $service"
            Compose @("build", $service)
        }
    }

    Step "Applying migrations twice to verify idempotence"
    Compose @("--profile", "tools", "run", "--rm", "migrate")
    Compose @("--profile", "tools", "run", "--rm", "migrate")

    Step "Starting application services"
    Compose @("up", "-d", "--force-recreate", "api", "worker", "web", "admin", "mock-new-api")
    foreach ($service in @("api", "worker", "web", "admin", "mock-new-api")) { Wait-Healthy $service }

    Step "Checking API health and metrics"
    $health = Invoke-RestMethod "http://localhost:18080/health" -TimeoutSec 10
    if ($health.data.status -ne "ok") { throw "API health failed" }
    $metrics = Invoke-WebRequest "http://localhost:18080/metrics" -UseBasicParsing -TimeoutSec 10
    if ($metrics.Content -notmatch "starai_http_requests_total") { throw "metrics endpoint failed" }

    Step "Running integration suite"
    $integrationPath = Join-Path $Root "scripts/integration-test.ps1"
    $integrationTemp = Join-Path ([IO.Path]::GetTempPath()) "starai-integration-$([guid]::NewGuid().ToString('N')).ps1"
    [IO.File]::WriteAllText($integrationTemp, (Get-Content -Raw -Encoding UTF8 $integrationPath), (New-Object Text.UTF8Encoding($true)))
    try {
        & $integrationTemp -API "http://localhost:18080"
        if ($LASTEXITCODE -ne 0) { throw "integration suite failed" }
    } finally {
        Remove-Item $integrationTemp -Force -ErrorAction SilentlyContinue
    }

    Step "Pre-production verification passed"
} finally {
    if (-not $KeepRunning) {
        Step "Stopping isolated pre-production containers"
        & docker compose --project-name $Project --env-file $EnvFile -f $ComposeFile --profile preprod --profile tools down -v --remove-orphans
    } else {
        Step "Keeping pre-production running: web=http://localhost:13000 admin=http://localhost:13001"
    }
}
