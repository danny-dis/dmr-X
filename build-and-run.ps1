# DMR-X Build & Run Script
# Run with: powershell -ExecutionPolicy Bypass -File build-and-run.ps1

$ErrorActionPreference = "SilentlyContinue"
$base = "C:\Users\pc\Documents\projects\DMR-X"
Set-Location $base

Write-Host "=== DMR-X Build & Run ===" -ForegroundColor Cyan

# Step 0: Kill existing gateway/bun processes
Write-Host "`n[0/5] Cleaning up old processes..." -ForegroundColor Yellow
Get-Process | Where-Object { $_.ProcessName -eq "bun" -and $_.Id -ne $PID } | ForEach-Object {
    Write-Host "  Killing PID $($_.Id)"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# Step 1: Register workspace packages
Write-Host "`n[1/5] Registering workspace packages..." -ForegroundColor Yellow
$pkgs = Get-ChildItem -Path "packages","services" -Directory
foreach ($p in $pkgs) {
    Set-Location $p.FullName
    bun link 2>$null
}
Write-Host "  Registered $($pkgs.Count) packages"

# Step 2: Link packages in root project
Set-Location $base
foreach ($p in $pkgs) {
    bun link "@dmr-x/$($p.Name)" 2>$null
}

# Step 3: Create junctions
Write-Host "`n[3/5] Creating junctions in node_modules/@dmr-x/..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "node_modules\@dmr-x" | Out-Null
foreach ($p in $pkgs) {
    $linkPath = "node_modules\@dmr-x\$($p.Name)"
    $targetPath = $p.FullName
    if (-not (Test-Path $linkPath)) {
        cmd /c "mklink /D `"$linkPath`" `"$targetPath`"" 2>$null | Out-Null
    }
}
$linked = (Get-ChildItem "node_modules\@dmr-x" -Directory).Count
Write-Host "  Created $linked junctions"

# Step 4: Build the gateway
Write-Host "`n[4/5] Building gateway..." -ForegroundColor Yellow
$bunfigContent = @'
[install]
workspaces = ["apps/*", "services/*", "packages/*"]
'@
$bunfigContent | Out-File -FilePath "bunfig.toml" -Encoding utf8 -Force

# Build all packages first, then gateway
$buildOrder = @("packages/db", "packages/utils", "packages/core", "packages/secrets", "packages/tokenizers", "packages/provider-catalog", "packages/cli", "packages/plugin-loader", "packages/agent-pc")
foreach ($b in $buildOrder) {
    Write-Host "  Building $b..."
    Set-Location "$base\$b"
    bun build src/index.ts --target bun --outdir dist 2>$null
    if (-not $?) {
        npx tsc -b --force 2>$null
    }
}

# Build services
$serviceOrder = @("services/agent-registry", "services/agent-runtime", "services/billing", "services/memory", "services/router", "services/federation", "services/adapters", "services/benchmark", "services/cache", "services/godmode", "services/mcp-client", "services/mcp-server", "services/oauth", "services/operator", "services/plugin-loader-bootstrap", "services/policy", "services/prompts", "services/quota", "services/registry", "services/sandbox", "services/server-manager", "services/telemetry", "services/tool-search", "services/workers")
foreach ($s in $serviceOrder) {
    Write-Host "  Building $s..."
    Set-Location "$base\$s"
    bun build src/*.ts --target bun --outdir dist/src 2>$null
    if (-not $?) {
        npx tsc -b --force 2>$null
    }
}

# Build gateway
Write-Host "  Building apps/gateway..."
Set-Location "$base\apps\gateway"
bun build src/main.ts --target bun --outfile gateway-binary 2>$null
if (-not $?) {
    npx tsc -b --force 2>$null
}

# Step 5: Start gateway
Write-Host "`n[5/5] Starting gateway..." -ForegroundColor Yellow
Set-Location $base

# Try compiled binary first
if (Test-Path "apps\gateway\gateway-binary") {
    Write-Host "  Starting compiled gateway binary..."
    Start-Process -FilePath "$base\apps\gateway\gateway-binary" -NoNewWindow
} elseif (Test-Path "apps\gateway\dist\src\main.js") {
    Write-Host "  Starting from dist..."
    Start-Process -FilePath "bun" -ArgumentList "apps/gateway/dist/src/main.js" -NoNewWindow
} else {
    Write-Host "  Falling back to bun --watch..." -ForegroundColor Red
    Start-Process -FilePath "bun" -ArgumentList "run dev:gateway" -NoNewWindow
}

# Wait for gateway to start
Write-Host "  Waiting for gateway to start..."
Start-Sleep -Seconds 10

# Test
$health = Invoke-WebRequest -Uri "http://localhost:47113/health" -UseBasicParsing -ErrorAction SilentlyContinue
if ($health.StatusCode -eq 200) {
    Write-Host "`n=== Gateway is RUNNING ===" -ForegroundColor Green
    Write-Host "  Health: $($health.Content)"
    
    # Test agent chat
    Write-Host "`n=== Testing agent chat ===" -ForegroundColor Yellow
    $chatBody = '{"messages":[{"role":"user","content":"Say hello"}],"maxSteps":1}'
    $chatResp = Invoke-WebRequest -Uri "http://localhost:47113/v1/agents/e5c26361-a8ed-406b-b492-626a9e22c4da/chat" -Method POST -ContentType "application/json" -Body $chatBody -UseBasicParsing -ErrorAction SilentlyContinue
    Write-Host "  Chat response: $($chatResp.Content.Substring(0, [Math]::Min(200, $chatResp.Content.Length)))"
    
    # Test evaluations
    Write-Host "`n=== Testing evaluations ===" -ForegroundColor Yellow
    $evalResp = Invoke-WebRequest -Uri "http://localhost:47113/v1/instances/e5c26361-a8ed-406b-b492-626a9e22c4da/evaluations?limit=1" -UseBasicParsing -ErrorAction SilentlyContinue
    Write-Host "  Evaluations: $($evalResp.Content)"
} else {
    Write-Host "`n=== Gateway did NOT start ===" -ForegroundColor Red
    Write-Host "  Check logs above for errors"
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
