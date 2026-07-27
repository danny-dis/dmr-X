# DMR-X always-on launcher for pre-built binary.
# Starts the gateway on port 47113 in a crash-restart loop.
# Loads .env from user home and project directory (project overrides).
# Used by Windows Task Scheduler "DMR-X-Binary" task.

$ErrorActionPreference = 'Continue'

# Paths
$BinaryPath = Join-Path $env:USERPROFILE '.dmr-x\bin\dmrx.exe'
$HomeEnv = Join-Path $env:USERPROFILE '.dmr-x\.env'
$ProjectEnv = 'C:\Users\pc\Documents\projects\DMR-X\.env'
$LogDir = Join-Path $env:USERPROFILE '.dmr-x\logs'
$LogFile = Join-Path $LogDir 'dmrx.log'
$GatewayLog = Join-Path $LogDir 'gateway.log'
$ErrLogFile = Join-Path $LogDir 'dmrx.err.log'
$LockFile = Join-Path $env:USERPROFILE '.dmr-x\dmrx-alwayson.pid'

# Ensure bun is in PATH (needed for companion services)
$BunDir = Join-Path $env:USERPROFILE '.bun\bin'
if (Test-Path $BunDir) {
    $env:PATH = "$BunDir;$env:PATH"
}

# Create log directory if missing
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-Log([string]$Message) {
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $entry = "[$timestamp] $Message"
    Write-Host $entry
    Add-Content -Path $LogFile -Value $entry
}

function Test-PortListen([int]$Port) {
    $lines = netstat -ano 2>$null | Select-String -Pattern ":$Port\s" | Select-String 'LISTEN'
    return $null -ne $lines
}

# Clear stale binders on gateway port
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
$PID | Set-Content -Path $LockFile -Encoding ascii

# Load .env files (home first, then project overrides)
function Load-EnvFile([string]$Path) {
    if (-not (Test-Path $Path)) { return }
    $first = $true
    Get-Content $Path | ForEach-Object {
        $line = $_
        # Strip a UTF-8 BOM off the first line. Without this the leading key
        # parses as "<BOM>PORT" and is silently dropped by every consumer.
        if ($first) { $line = $line -replace '^﻿', ''; $first = $false }
        if ($line -match '^\s*#' -or $line -match '^\s*$') { return }
        if ($line -match '^([^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2]
            if ($value -match '^"(.*)"$') { $value = $matches[1] }
            elseif ($value -match "^'(.*)'$") { $value = $matches[1] }
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

Load-EnvFile $HomeEnv
Load-EnvFile $ProjectEnv

# Set default environment variables if not already set
if (-not $env:PORT) { $env:PORT = '47113' }
if (-not $env:DMRX_LOCAL_MODE) { $env:DMRX_LOCAL_MODE = 'true' }
if (-not $env:DMRX_GATEWAY_URL) { $env:DMRX_GATEWAY_URL = 'http://localhost:47113' }
# Ensure DMRX_DATA_DIR points to user home data directory
if (-not $env:DMRX_DATA_DIR) { $env:DMRX_DATA_DIR = Join-Path $env:USERPROFILE '.dmr-x' }
# Disable companion autostart in the binary (uv_spawn bug on Windows).
# We'll start companions separately below.
if (-not $env:DMRX_MCP_AUTOSTART) { $env:DMRX_MCP_AUTOSTART = 'false' }
if (-not $env:DMRX_GODMODE_AUTOSTART) { $env:DMRX_GODMODE_AUTOSTART = 'false' }

Write-Log "DMR-X always-on launcher started (binary)"
Write-Log "Binary: $BinaryPath"
Write-Log "Gateway URL: $env:DMRX_GATEWAY_URL"
Write-Log "Data directory: $env:DMRX_DATA_DIR"
Write-Log "Logs: $LogFile"
Write-Log "Bun path: $BunDir"

# Companion process tracking
$script:McpProc = $null
$script:GodmodeProc = $null
$BunExe = Join-Path $BunDir 'bun.exe'

function Start-Companions {
    # Set MCP transport to SSE so it listens on port 3100, enable A2A
    $env:DMRX_MCP_TRANSPORT = 'sse'
    $env:DMRX_MCP_PORT = '3100'
    $env:DMRX_A2A_ENABLED = 'true'
    $env:GODMODE_RELAY = '1'
    $env:G0DM0D3_LLM_BASE_URL = "$env:DMRX_GATEWAY_URL/v1"

    # Start MCP server (needs SSE transport to listen on port 3100)
    $mcpEntry = 'C:\Users\pc\Documents\projects\DMR-X\services\mcp-server\dist\index.js'
    if (Test-Path $mcpEntry) {
        Write-Log "Starting MCP server (with A2A) on :3100 (SSE transport)..."
        $script:McpProc = Start-Process -FilePath $BunExe -ArgumentList $mcpEntry `
            -WorkingDirectory 'C:\Users\pc\Documents\projects\DMR-X' `
            -PassThru -NoNewWindow -ErrorAction SilentlyContinue
        Write-Log "MCP server (with A2A) started (PID: $($script:McpProc.Id))"
    } else {
        Write-Log "Warning: MCP entry not found at $mcpEntry"
    }

    # Start G0DM0D3
    $g0dm0d3Dir = 'C:\Users\pc\Documents\projects\DMR-X\.dmrx-data\servers\g0dm0d3'
    if (Test-Path $g0dm0d3Dir) {
        Write-Log "Starting G0DM0D3 on :7860..."
        $script:GodmodeProc = Start-Process -FilePath $BunExe -ArgumentList 'x','tsx','api/server.ts' `
            -WorkingDirectory $g0dm0d3Dir `
            -PassThru -NoNewWindow -ErrorAction SilentlyContinue
        Write-Log "G0DM0D3 started (PID: $($script:GodmodeProc.Id))"
    } else {
        Write-Log "Warning: G0DM0D3 directory not found at $g0dm0d3Dir"
    }

    # Wait for companion ports to come up
    $maxWait = 20
    for ($i = 0; $i -lt $maxWait; $i++) {
        Start-Sleep -Seconds 1
        $mcpUp = Test-PortListen 3100
        $g0dUp  = Test-PortListen 7860
        if ($mcpUp -and $g0dUp) {
            Write-Log "Companions healthy (MCP+A2A :3100, G0DM0D3 :7860)"
            return
        }
        if ($i -eq $maxWait - 1) {
            Write-Log "Companion status (MCP+A2A=$mcpUp, G0DM0D3=$g0dUp)"
        }
    }
}

function Stop-Companions {
    if ($script:McpProc) {
        try { Stop-Process -Id $script:McpProc.Id -Force -ErrorAction SilentlyContinue } catch {}
        $script:McpProc = $null
    }
    if ($script:GodmodeProc) {
        try { Stop-Process -Id $script:GodmodeProc.Id -Force -ErrorAction SilentlyContinue } catch {}
        $script:GodmodeProc = $null
    }
}

# Main crash-restart loop
while ($true) {
    if (Test-PortListen 47113) {
        # Check companion health every 10s while gateway is alive
        Start-Sleep -Seconds 10
        $mcpAlive  = Test-PortListen 3100
        $g0dAlive  = Test-PortListen 7860
        if (-not $mcpAlive -or -not $g0dAlive) {
            Write-Log "Companion(s) down (MCP=$mcpAlive, G0DM0D3=$g0dAlive) - restarting..."
            Start-Companions
        }
        continue
    }
    Stop-Companions
    Write-Log "Starting DMR-X gateway on :47113..."
    $proc = Start-Process -FilePath $BinaryPath `
        -PassThru -NoNewWindow `
        -RedirectStandardOutput $GatewayLog `
        -RedirectStandardError $ErrLogFile
    # Wait for gateway to start listening, then launch companions
    $waited = 0
    while ($waited -lt 15) {
        Start-Sleep -Seconds 1
        $waited++
        if (Test-PortListen 47113) {
            Start-Companions
            break
        }
    }
    Wait-Process -Id $proc.Id
    Write-Log "Gateway exited (exit code $($proc.ExitCode)). Restarting in 3s..."
    Start-Sleep -Seconds 3
}