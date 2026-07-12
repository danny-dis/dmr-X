Get-Process -Name bun -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
$r = Get-Process -Name bun -ErrorAction SilentlyContinue
if ($r) {
    'STILL RUNNING: ' + ($r.Id -join ',')
} else {
    'all bun killed'
}
