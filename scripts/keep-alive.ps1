# keep-alive.ps1 — Watchdog for DMR-X production server
# Checks every 10s, restarts the server if it dies.

$ProjectRoot = "C:\Users\pc\Documents\projects\DMR-X"
$GatewayScript = "apps\gateway\src\main.ts"
$HealthUrl = "http://localhost:3003/healthz"
$MaxHealthRetries = 3
$HealthTimeout = 5

function Test-ServerAlive {
    try {
        $resp = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec $HealthTimeout -ErrorAction Stop
        return $resp.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Start-DMRXServer {
    # Kill any lingering bun processes on port 3003
    $existing = Get-NetTCPConnection -LocalPort 3003 -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $existing) {
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1

    # Start the gateway
    $proc = Start-Process -FilePath "bun" `
        -ArgumentList $GatewayScript `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -PassThru
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Started DMR-X gateway (PID $($proc.Id))"
    return $proc
}

Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] DMR-X keep-alive watchdog started"

while ($true) {
    if (-not (Test-ServerAlive)) {
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Server not responding, restarting..."
        Start-DMRXServer | Out-Null
        # Wait for startup
        Start-Sleep -Seconds 5

        # Verify it came back
        $retries = 0
        while (-not (Test-ServerAlive) -and $retries -lt $MaxHealthRetries) {
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Health check failed, retrying ($($retries+1)/$MaxHealthRetries)..."
            Start-Sleep -Seconds 3
            $retries++
        }

        if (Test-ServerAlive) {
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Server recovered successfully"
        } else {
            Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Server failed to recover after $MaxHealthRetries retries"
        }
    }
    Start-Sleep -Seconds 10
}
