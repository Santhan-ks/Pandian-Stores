$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-DockerEngineType {
    # Windows PowerShell can turn native stderr into terminating errors even
    # when redirected. A stopped engine is expected during this readiness probe.
    $ErrorActionPreference = 'Continue'
    $result = & docker info --format '{{.OSType}}' 2>$null
    if ($LASTEXITCODE -eq 0) { return ($result -join '').Trim() }
    return $null
}

try {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    Set-Location -LiteralPath $projectRoot

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Install Docker Desktop with Linux containers, then run this launcher again.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) {
        throw 'Local setup is missing. Follow the README setup instructions to configure .env and seed the demo first.'
    }

    Write-Host 'Pandian Stores - Local demonstration' -ForegroundColor Cyan
    Write-Host '[1/3] Checking Docker...'
    $engineType = Get-DockerEngineType
    if (-not $engineType) {
        $desktopPath = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        if (-not (Test-Path -LiteralPath $desktopPath)) {
            throw 'Docker is not running. Start your Docker engine, then run this launcher again.'
        }
        Write-Host 'Starting Docker Desktop. Waiting up to two minutes for its engine...'
        Start-Process -FilePath $desktopPath -WindowStyle Hidden | Out-Null
        $deadline = (Get-Date).AddMinutes(2)
        do {
            Start-Sleep -Seconds 2
            $engineType = Get-DockerEngineType
            if ($engineType) { break }
        } while ((Get-Date) -lt $deadline)
        if (-not $engineType) {
            throw 'Docker did not become ready. Check Docker Desktop, then run this launcher again.'
        }
    }
    if ($engineType -ne 'linux') {
        throw 'Switch Docker Desktop to Linux containers, then run this launcher again.'
    }

    # Reuse this workstation's existing demo project and its persistent volume.
    # The hardened TLS installation is a separate project.
    $demoProject = 'pandian-stores'
    if ($env:COMPOSE_PROJECT_NAME) { $demoProject = $env:COMPOSE_PROJECT_NAME }
    $composeArgs = @('compose', '-f', (Join-Path $projectRoot 'compose.yaml'), '-p', $demoProject)
    Write-Host ('[2/3] Starting database and app (project: ' + $demoProject + ')...')
    & docker @composeArgs config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Docker configuration failed. Check the private .env using the README.' }

    & docker @composeArgs up -d --no-build --wait --wait-timeout 180 db app
    if ($LASTEXITCODE -ne 0) {
        throw 'Demo startup failed. Check Docker Desktop and port availability. If the demo has never been installed, complete the README setup using this Compose project name first.'
    }

    $binding = & docker @composeArgs port app 3000
    if ($LASTEXITCODE -ne 0 -or $binding -notmatch '^127\.0\.0\.1:(\d+)$') {
        throw 'Could not identify the local demo port. Check the loopback port configuration in compose.yaml.'
    }
    $baseUrl = 'http://localhost:' + $Matches[1]
    # Docker publishes IPv4 loopback. Avoid Windows PowerShell's slow IPv6
    # localhost fallback while keeping the browser's configured origin intact.
    $healthUrl = 'http://127.0.0.1:' + $Matches[1] + '/api/health'
    Write-Host '[3/3] Checking the application...'
    $health = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 15
    if ($health.StatusCode -ne 200) { throw 'The app did not pass its HTTP health check.' }

    $loginUrl = $baseUrl + '/login'
    Write-Host ''
    Write-Host ('Pandian Stores is ready: ' + $loginUrl) -ForegroundColor Green
    Write-Host 'Demo accounts and their password are listed under Demo logins and roles in README.md.'
    Write-Host 'Opening your browser. The app keeps running after this window closes.'
    Write-Host ('To stop it later without deleting data: docker compose -p ' + $demoProject + ' stop')
    Start-Process -FilePath $loginUrl
    exit 0
}
catch {
    Write-Host ''
    Write-Host ('Could not start Pandian Stores: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
