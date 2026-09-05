# Self-contained script to link all workspace packages and start the gateway
$ErrorActionPreference = "SilentlyContinue"
$base = "C:\Users\pc\Documents\projects\DMR-X"
Set-Location $base

# 1. Register each workspace package
Write-Host "=== Registering workspace packages ==="
Get-ChildItem -Path "packages","services" -Directory | ForEach-Object {
    Set-Location $_.FullName
    $name = $_.Name
    bun link 2>$null
    Write-Host "  Registered: $name"
}

# 2. Create symlinks in node_modules/@dmr-x/
Set-Location $base
New-Item -ItemType Directory -Force -Path "node_modules\@dmr-x" | Out-Null

Get-ChildItem -Path "packages","services" -Directory | ForEach-Object {
    $name = $_.Name
    $linkPath = "node_modules\@dmr-x\$name"
    if (-not (Test-Path $linkPath)) {
        cmd /c "mklink /D `"$linkPath`" `"$($p.FullName)`"" 2>$null | Out-Null
        Write-Host "  Linked: $name"
    }
}

# 3. Verify
Write-Host "`n=== node_modules/@dmr-x contents ==="
Get-ChildItem "node_modules\@dmr-x" -Directory | Select-Object -ExpandProperty Name

# 4. Check if gateway can resolve
Write-Host "`n=== Testing gateway imports ==="
$testFile = "$base\apps\gateway\src\main.ts"
$content = Get-Content $testFile -Raw
if ($content -match '@dmr-x/db') { Write-Host "  Found @dmr-x/db import in main.ts" }

# 5. Try building gateway main.ts
Write-Host "`n=== Building gateway ==="
bun build apps/gateway/src/main.ts --target bun --outfile /tmp/dmrx-test 2>&1 | Select-Object -Last 5

Write-Host "`n=== Done ==="
