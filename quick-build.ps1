$ErrorActionPreference = "SilentlyContinue"
$base = "C:\Users\pc\Documents\projects\DMR-X"
Set-Location $base

Write-Host "=== Quick Build & Run ===" -ForegroundColor Cyan

# Build all packages with bun build
$buildTargets = @(
    "packages/db/src/index.ts",
    "packages/utils/src/index.ts",
    "packages/core/src/index.ts",
    "packages/secrets/src/index.ts",
    "packages/tokenizers/src/index.ts",
    "packages/provider-catalog/src/index.ts",
    "packages/cli/src/index.ts",
    "packages/plugin-loader/src/index.ts",
    "packages/agent-pc/src/index.ts",
    "services/agent-registry/src/index.ts",
    "services/agent-runtime/src/agent-runtime.ts",
    "services/billing/src/index.ts",
    "services/memory/src/index.ts",
    "services/router/src/index.ts",
    "services/federation/src/index.ts",
    "services/adapters/src/index.ts",
    "services/benchmark/src/index.ts",
    "services/cache/src/index.ts",
    "services/godmode/src/index.ts",
    "services/mcp-client/src/index.ts",
    "services/mcp-server/src/index.ts",
    "services/oauth/src/index.ts",
    "services/operator/src/index.ts",
    "services/plugin-loader-bootstrap/src/index.ts",
    "services/policy/src/index.ts",
    "services/prompts/src/index.ts",
    "services/quota/src/index.ts",
    "services/registry/src/index.ts",
    "services/sandbox/src/index.ts",
    "services/server-manager/src/index.ts",
    "services/telemetry/src/index.ts",
    "services/tool-search/src/index.ts",
    "services/workers/src/index.ts"
)

foreach ($t in $buildTargets) {
    $dir = Split-Path (Split-Path $t -Parent) -Parent
    $name = Split-Path $dir -Leaf
    $outdir = "$dir\dist"
    Write-Host "  Building $name..."
    bun build $t --target bun --outdir $outdir 2>$null
}

# Build gateway
Write-Host "  Building gateway..."
bun build apps/gateway/src/main.ts --target bun --outfile apps/gateway/gateway-bin 2>$null

Write-Host "`nBuild complete. Starting gateway..."
if (Test-Path "apps/gateway/gateway-bin") {
    Start-Process -FilePath "apps/gateway/gateway-bin" -NoNewWindow
    Start-Sleep -Seconds 8
    curl -s http://localhost:47113/health 2>$null
}

Write-Host "`nDone"
