# DMR-X always-on launcher (PowerShell).
# Starts the gateway (:47113) in a crash-restart loop. On listen, the gateway
# auto-boots MCP+A2A (:3100) and G0DM0D3 (:7860) via startCompanionServices()
# unless DMRX_MCP_AUTOSTART / DMRX_GODMODE_AUTOSTART are set to false.
#
# Used by scripts/dev/run-gateway.bat (Task Scheduler "DMR-X-Gateway").

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root 'apps\gateway'))) {
  $Root = 'C:\Users\pc\Documents\projects\DMR-X'
}
Set-Location $Root

$Lock = Join-Path $Root '.dmrx-alwayson.pid'
$Bun = if (Test-Path "$env:USERPROFILE\.bun\bin\bun.exe") {
  "$env:USERPROFILE\.bun\bin\bun.exe"
} else {
  'bun'
}

function Test-PortListen([int]$Port) {
  $lines = netstat -ano 2>$null | Select-String -Pattern ":$Port\s" | Select-String 'LISTEN'
  return $null -ne $lines
}

# Yield if another supervisor already owns the gateway port.
if (Test-PortListen 47113) {
  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Gateway already listening on :47113 — exiting to avoid conflict."
  exit 0
}

# Clear stale binders on gateway port only (MCP/godmode are gateway-managed).
foreach ($port in @(47113)) {
  $pids = netstat -ano 2>$null |
    Select-String -Pattern ":$port\s" |
    Select-String 'LISTEN' |
    ForEach-Object { ($_ -split '\s+')[-1] } |
    Where-Object { $_ -match '^\d+$' -and $_ -ne '0' } |
    Select-Object -Unique
  foreach ($p in $pids) {
    Start-Process -FilePath 'taskkill' -ArgumentList "/PID",$p,"/F" -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
  }
}
Start-Sleep -Seconds 1
$PID | Set-Content -Path $Lock -Encoding ascii

# Load .env into this process (and thus children).
if (Test-Path '.env') {
  Get-Content '.env' | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^([^=]+)=(.*)$') {
      $n = $matches[1].Trim()
      $v = $matches[2]
      if ($v -match '^"(.*)"$') { $v = $matches[1] }
      elseif ($v -match "^'(.*)'$") { $v = $matches[1] }
      [Environment]::SetEnvironmentVariable($n, $v, 'Process')
    }
  }
}

if (-not $env:DMRX_LOCAL_MODE) { $env:DMRX_LOCAL_MODE = 'true' }
if (-not $env:DMRX_GATEWAY_URL) { $env:DMRX_GATEWAY_URL = 'http://localhost:47113' }
if (-not $env:DMRX_GODMODE_AUTOSTART) { $env:DMRX_GODMODE_AUTOSTART = 'true' }
if (-not $env:DMRX_MCP_AUTOSTART) { $env:DMRX_MCP_AUTOSTART = 'true' }

$GwLog = Join-Path $Root 'gateway.log'
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] DMR-X always-on launcher started (gateway; MCP+A2A+godmode via companion boot)"

while ($true) {
  if (Test-PortListen 47113) {
    Start-Sleep -Seconds 3
    continue
  }
  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting DMR-X gateway on :47113..."
  $gwDir = Join-Path $Root 'apps\gateway'
  # Mirror bash alwayson: bun --env-file=../../.env run start, append to gateway.log
  $proc = Start-Process -FilePath $Bun `
    -ArgumentList @('--env-file=../../.env','run','start') `
    -WorkingDirectory $gwDir `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput $GwLog `
    -RedirectStandardError (Join-Path $Root 'gateway.err.log')
  Wait-Process -Id $proc.Id
  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Gateway exited ($($proc.ExitCode)). Restarting in 3s..."
  Start-Sleep -Seconds 3
}
