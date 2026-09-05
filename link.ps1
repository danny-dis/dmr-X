$base = "C:\Users\pc\Documents\projects\DMR-X"
$pkgs = Get-ChildItem -Path "$base\packages","$base\services" -Directory
New-Item -ItemType Directory -Force -Path "$base\node_modules\@dmr-x" | Out-Null
foreach ($p in $pkgs) {
    $linkPath = "$base\node_modules\@dmr-x\$($p.Name)"
    if (-not (Test-Path $linkPath)) {
        cmd /c "mklink /D `"$linkPath`" `"$($p.FullName)`"" 2>$null | Out-Null
        Write-Host "Linked $($p.Name)"
    }
}
Write-Host "Done. Contents:"
Get-ChildItem "$base\node_modules\@dmr-x" -Directory | Select-Object -ExpandProperty Name
