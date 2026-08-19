# DMR-X always-on launcher.
# Keeps the gateway running and the MCP+A2A (:47114) and G0DM0D3 (:7860)
# companions alive alongside it. The gateway itself is started through PM2
# (source code with all fixes) — the compiled binary lineage had
# false-corruption detection and silent data loss on restart, so it is never
# launched from here.
# Loads .env from user home and project directory (project overrides).
# Used by Windows Task Scheduler / Startup VBS.

$ErrorActionPreference = 'Continue'

# Paths
$ProjectRoot = 'C:\Users\pc\Documents\projects\DMR-X'
$BinaryPath = Join-Path $env:USERPROFILE '.dmr-x\bin\dmrx.exe'
$HomeEnv = Join-Path $env:USERPROFILE '.dmr-x\.env'
$ProjectEnv = Join-Path $ProjectRoot '.env'
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

function Get-PortOwnerPids([int]$Port) {
    netstat -ano 2>$null |
        Select-String -Pattern ":$Port\s" |
        Select-String 'LISTEN' |
        ForEach-Object { ($_ -split '\s+')[-1] } |
        Where-Object { $_ -match '^\d+$' -and $_ -ne '0' } |
        Select-Object -Unique
}

# Is this PID demonstrably one of ours?
#
# Mirrors isOurCompanion() in apps/gateway/src/lib/sidecar-boot.ts. The port
# clearing below force-kills whatever it finds, and this launcher is not the only
# thing that may hold the gateway port — a PM2-supervised gateway run from source
# reads the same .env and targets the same port. Killing blind would destroy that,
# or any unrelated program that happens to be listening. A process we cannot
# positively identify is never ours.
function Test-IsOurProcess([int]$ProcessId) {
    try {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    } catch {
        return $false
    }
    if (-not $proc) { return $false }
    $cmd = "$($proc.CommandLine) $($proc.ExecutablePath)".Trim().ToLower()
    if (-not $cmd) { return $false }   # unidentifiable — leave it alone
    if ($cmd -like '*dmrx.exe*') { return $true }
    if ($cmd -like "*$($ProjectRoot.ToLower())*") {
        return ($cmd -like '*mcp-server*' -or
                $cmd -like '*g0dm0d3*' -or
                $cmd -like '*api/server.ts*' -or
                $cmd -like '*api\server.ts*' -or
                $cmd -like '*gateway/src/main.ts*' -or
                $cmd -like '*gateway\src\main.ts*')
    }
    return $false
}

# Is this PID the fixed source gateway running under PM2 (bun/node +
# apps/gateway/src/main.ts)? PM2 passes the script path relative to the project
# root, so the entry-path patterns are matched directly rather than against the
# full project root. Recognising it means we ADOPT a healthy pm2 gateway at
# startup instead of killing it (the binary legacy) and instead of treating it
# as a foreign process (which would abort the launcher).
function Test-IsSourceGateway([int]$ProcessId) {
    try {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    } catch {
        return $false
    }
    if (-not $proc) { return $false }
    $cmd = "$($proc.CommandLine) $($proc.ExecutablePath)".Trim().ToLower()
    if (-not $cmd) { return $false }
    return ($cmd -like '*gateway/src/main.ts*' -or
            $cmd -like '*gateway\src\main.ts*')
}

# The gateway resolves its web UI from "<directory of the exe>\public" (see the
# candidateDirs list in apps/gateway/src/server.ts). Deploying dmrx.exe on its own
# leaves the API perfectly healthy while every browser request gets
# {"error":"Not Found"} — index.html is absent, so the SPA fallback disables
# itself. Keep the built UI beside the binary so that cannot happen.
function Sync-GatewayUi {
    $srcDir = Join-Path $ProjectRoot 'apps\gateway\public'
    $srcIndex = Join-Path $srcDir 'index.html'
    if (-not (Test-Path $srcIndex)) {
        Write-Log "Warning: no UI build at $srcDir - the web UI will 404. Run 'bun run build:ui'."
        return
    }
    $destDir = Join-Path (Split-Path -Parent $BinaryPath) 'public'
    $destIndex = Join-Path $destDir 'index.html'
    $needsCopy = $true
    if (Test-Path $destIndex) {
        $needsCopy = (Get-Item $srcIndex).LastWriteTimeUtc -gt (Get-Item $destIndex).LastWriteTimeUtc
    }
    if (-not $needsCopy) { return }
    try {
        New-Item -ItemType Directory -Path $destDir -Force -ErrorAction Stop | Out-Null
        Copy-Item -Path (Join-Path $srcDir '*') -Destination $destDir -Recurse -Force -ErrorAction Stop
        Write-Log "Deployed UI: $srcDir -> $destDir"
    } catch {
        Write-Log "Warning: could not deploy UI to $destDir - $($_.Exception.Message)"
    }
}

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

if (-not $env:PORT) { $env:PORT = '47113' }
if (-not $env:DMRX_LOCAL_MODE) { $env:DMRX_LOCAL_MODE = 'true' }

# Resolve the gateway port AFTER the .env files are loaded, never before: the
# gateway itself reads .env, so deriving this any earlier pins the launcher to
# the default while the gateway binds whatever .env actually says. The launcher
# would then poll a port nothing is listening on and restart a healthy gateway
# forever.
$GwPort = 0
if ($env:PORT -match '^\s*(\d+)\s*$') { $GwPort = [int]$matches[1] }
if ($GwPort -lt 1 -or $GwPort -gt 65535) {
    Write-Log "Warning: PORT='$env:PORT' is not a valid port - falling back to 47113"
    $GwPort = 47113
    $env:PORT = '47113'
}

if (-not $env:DMRX_GATEWAY_URL) { $env:DMRX_GATEWAY_URL = "http://localhost:$GwPort" }
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
Write-Log "Gateway port: $GwPort"

# Reap a gateway stranded on our port by a previous run — but only ever one of
# ours. Companion ports (47114 / 7860) are deliberately NOT cleared here: the
# supervisor loop below adopts a healthy companion and restarts a dead one, so
# killing them on every boot would cause avoidable downtime for no benefit.
foreach ($p in (Get-PortOwnerPids $GwPort)) {
    # A healthy pm2-supervised source gateway already owns the port: adopt it.
    # Never kill it, and do not treat it as foreign (which would abort the
    # launcher). Only the binary legacy (dmrx.exe) and companions get reaped.
    if (Test-IsSourceGateway ([int]$p)) {
        Write-Log "Source gateway already running on :$GwPort (PID $p) - adopting"
        continue
    }
    if (Test-IsOurProcess ([int]$p)) {
        Write-Log "Clearing stale DMR-X process holding :$GwPort (PID $p)"
        Start-Process -FilePath 'taskkill' -ArgumentList "/PID",$p,"/F" -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
    } else {
        $name = try { (Get-Process -Id ([int]$p) -ErrorAction Stop).ProcessName } catch { 'unknown' }
        Write-Log "ABORT: port $GwPort is held by PID $p ($name), which is not a DMR-X process."
        Write-Log "Refusing to force-kill it. Stop that process, or set PORT to a free port, then retry."
        exit 1
    }
}
Start-Sleep -Seconds 1
$PID | Set-Content -Path $LockFile -Encoding ascii

# Make sure the UI is beside the binary before anything can serve a request.
Sync-GatewayUi

# Companion process tracking
$script:McpProc = $null
$script:GodmodeProc = $null
$BunExe = Join-Path $BunDir 'bun.exe'

function Start-Companions {
    # ONE MCP instance on :47114 serving BOTH MCP and A2A.
    #
    # This used to force SSE on :3100 while the PM2 entry ran streamable-http
    # on :47114, so TWO MCP servers ran side by side from the same dist — the
    # /mcp path only exists on streamable-http, so clients pointed at :3100
    # failed the initialize handshake while :47114 worked. A2A shares the port
    # with MCP by design (card at /.well-known/agent-card.json, JSON-RPC at
    # /a2a), so there is no reason to split them.
    $env:DMRX_MCP_TRANSPORT = 'http'
    $env:DMRX_MCP_PORT = '47114'
    $env:DMRX_A2A_ENABLED = 'true'
    $env:GODMODE_RELAY = '1'
    $env:G0DM0D3_LLM_BASE_URL = "$env:DMRX_GATEWAY_URL/v1"

    # Start MCP server (streamable-http on :47114, A2A on the same port)
    $mcpEntry = Join-Path $ProjectRoot 'services\mcp-server\dist\index.js'
    if (Test-Path $mcpEntry) {
        Write-Log "Starting MCP server (with A2A) on :47114 (streamable-http)..."

        # MCP must NOT open the gateway's SQLite file. Both processes run the
        # migrations and both persist through sql.js's debounced whole-file
        # writes, so pointing them at one data.db makes them silently clobber
        # each other's work. apps/gateway/src/lib/sidecar-boot.ts isolates the
        # sidecar to .dmrx-data-mcp for exactly this reason; without the same
        # isolation here, MCP inherits DMRX_DATA_DIR and shares ~/.dmr-x/data.db.
        #
        # $env: mutates the whole PowerShell process, so the override is scoped
        # to this spawn and restored immediately — G0DM0D3 below and the gateway
        # itself must keep using the real data directory.
        $mcpDataDir = if ($env:DMRX_MCP_DATA_DIR) { $env:DMRX_MCP_DATA_DIR }
                      else { Join-Path $ProjectRoot '.dmrx-data-mcp' }
        $prevDataDir = $env:DMRX_DATA_DIR
        try {
            $env:DMRX_DATA_DIR = $mcpDataDir
            $child = Start-Process -FilePath $BunExe -ArgumentList $mcpEntry `
                -WorkingDirectory $ProjectRoot `
                -PassThru -NoNewWindow -ErrorAction SilentlyContinue
        } finally {
            # Setting 'Process' scope to $null unsets the variable, which is what
            # we want when it was not set to begin with — assigning '' instead
            # would leave an empty DMRX_DATA_DIR behind and send the gateway to
            # the wrong directory.
            [Environment]::SetEnvironmentVariable('DMRX_DATA_DIR', $prevDataDir, 'Process')
        }

        # Start-Process returns nothing when the spawn fails, and the old code
        # logged "(PID: )" while leaving the caller to believe MCP was running.
        if ($child -and $child.Id) {
            $script:McpProc = $child
            Write-Log "MCP server (with A2A) started (PID: $($child.Id), data dir: $mcpDataDir)"
        } else {
            Write-Log "ERROR: MCP server failed to start (bun at $BunExe, entry $mcpEntry)"
        }
    } else {
        Write-Log "Warning: MCP entry not found at $mcpEntry"
    }

    # Start G0DM0D3
    $g0dm0d3Dir = Join-Path $ProjectRoot '.dmrx-data\servers\g0dm0d3'
    if (Test-Path $g0dm0d3Dir) {
        Write-Log "Starting G0DM0D3 on :7860..."
        $child = Start-Process -FilePath $BunExe -ArgumentList 'x','tsx','api/server.ts' `
            -WorkingDirectory $g0dm0d3Dir `
            -PassThru -NoNewWindow -ErrorAction SilentlyContinue
        if ($child -and $child.Id) {
            $script:GodmodeProc = $child
            Write-Log "G0DM0D3 started (PID: $($child.Id))"
        } else {
            Write-Log "ERROR: G0DM0D3 failed to start (bun at $BunExe, dir $g0dm0d3Dir)"
        }
    } else {
        Write-Log "Warning: G0DM0D3 directory not found at $g0dm0d3Dir"
    }

    # Wait for companion ports to come up
    $maxWait = 20
    for ($i = 0; $i -lt $maxWait; $i++) {
        Start-Sleep -Seconds 1
        $mcpUp = Test-PortListen 47114
        $g0dUp  = Test-PortListen 7860
        if ($mcpUp -and $g0dUp) {
            Write-Log "Companions healthy (MCP+A2A :47114, G0DM0D3 :7860)"
            return
        }
        if ($i -eq $maxWait - 1) {
            Write-Log "Companion status (MCP+A2A=$mcpUp, G0DM0D3=$g0dUp)"
        }
    }
}

# Kill a whole process tree.
#
# Stop-Process only kills the PID it is given. G0DM0D3 runs as
# `bun x tsx` -> `tsx/cli.mjs` -> `node`, and the port is held by the deepest
# process, so killing the recorded wrapper leaves the actual server alive and
# still bound to 7860 — the next Start-Companions then spawns a second one on
# top of an orphan. taskkill /T takes the descendants with it.
function Stop-ProcessTree($Proc) {
    if (-not $Proc) { return }
    try {
        $procId = $Proc.Id
    } catch {
        return
    }
    if (-not $procId) { return }
    try {
        Start-Process -FilePath 'taskkill' -ArgumentList "/PID",$procId,"/T","/F" `
            -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
    } catch {
        try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
    }
}

function Stop-Companions {
    if ($script:McpProc) {
        Stop-ProcessTree $script:McpProc
        $script:McpProc = $null
    }
    if ($script:GodmodeProc) {
        Stop-ProcessTree $script:GodmodeProc
        $script:GodmodeProc = $null
    }
}

function Test-Pm2Available {
    try {
        return $null -ne (Get-Command pm2 -ErrorAction Stop)
    } catch {
        return $false
    }
}

# Start the gateway through PM2 — never the compiled binary.
#
# The binary at $BinaryPath belongs to a buggy lineage (false-corruption
# detection + silent data loss on restart). PM2 restores the saved process dump
# (dmrx-gateway + dmrx-needle-router), which runs the current source with all
# fixes. If PM2 is unavailable, log loudly and let the outer loop retry; we do
# NOT fall back to the binary.
function Start-GatewayViaPm2 {
    try {
        if (-not (Test-Pm2Available)) {
            Write-Log "ERROR: pm2 is not available. The gateway runs from source under pm2 - install pm2 or start 'dmrx-gateway' manually."
            return $false
        }
        # Restore the saved process list. Harmless when the apps are already up:
        # this branch is only reached while nothing listens on :$GwPort.
        pm2 resurrect 2>$null | Out-Null
        Start-Sleep -Seconds 1
        try {
            $list = pm2 jlist 2>$null | ConvertFrom-Json
            $online = @($list | Where-Object { $_.name -eq 'dmrx-gateway' -and $_.pm2_env.status -eq 'online' })
            if ($online.Count -eq 0) {
                Write-Log "Starting dmrx-gateway via pm2..."
                pm2 start dmrx-gateway 2>$null | Out-Null
            }
        } catch {
            Write-Log "WARNING: could not inspect pm2 list ($($_.Exception.Message)); starting 'dmrx-gateway' anyway..."
            pm2 start dmrx-gateway 2>$null | Out-Null
        }
        # Wait for the gateway to bind the port.
        $waited = 0
        while ($waited -lt 30) {
            Start-Sleep -Seconds 1
            $waited++
            if (Test-PortListen $GwPort) {
                Write-Log "Gateway online via pm2 (took ${waited}s)"
                return $true
            }
        }
        Write-Log "ERROR: gateway did not come up on :$GwPort within 30s (check 'pm2 list')"
        return $false
    } catch {
        Write-Log "ERROR: Start-GatewayViaPm2 failed: $($_.Exception.Message)"
        return $false
    }
}

# Main crash-restart loop
while ($true) {
    # Reached when the script starts while a gateway is already listening (an
    # externally supervised one, or a previous run of this script). We do not own
    # that process, so we only supervise its companions.
    if (Test-PortListen $GwPort) {
        Start-Sleep -Seconds 10
        $mcpAlive  = Test-PortListen 47114
        $g0dAlive  = Test-PortListen 7860
        if (-not $mcpAlive -or -not $g0dAlive) {
            Write-Log "Companion(s) down (MCP=$mcpAlive, G0DM0D3=$g0dAlive) - restarting..."
            Stop-Companions
            Start-Companions
        }
        continue
    }
    Stop-Companions
    # Start via pm2 — never spawn the compiled binary (buggy lineage).
    if (-not (Start-GatewayViaPm2)) {
        Write-Log "Gateway did not start via pm2. Retrying in 10s..."
        Start-Sleep -Seconds 10
        continue
    }
    Start-Companions
    # Supervise by polling, never by blocking.
    #
    # pm2 owns the gateway process (it crash-restarts it), so there is no
    # process handle to wait on here. This loop keeps companions alive while
    # the gateway listens and returns to the outer loop when it goes away.
    while (Test-PortListen $GwPort) {
        Start-Sleep -Seconds 10
        $mcpAlive = Test-PortListen 47114
        $g0dAlive = Test-PortListen 7860
        if (-not $mcpAlive -or -not $g0dAlive) {
            Write-Log "Companion(s) down during gateway runtime (MCP=$mcpAlive, G0DM0D3=$g0dAlive) - restarting..."
            # Reap before respawning: a companion can be alive but not listening
            # (G0DM0D3 has wedged this way), and spawning over it strands the old
            # process tree holding onto its port.
            Stop-Companions
            Start-Companions
        }
    }
    Write-Log "Gateway no longer listening on :$GwPort. Restarting in 3s..."
    Start-Sleep -Seconds 3
}