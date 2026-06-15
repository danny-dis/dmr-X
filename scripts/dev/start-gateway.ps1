$env:DMRX_LOCAL_MODE = "true"
$env:PORT = "3000"
Set-Location "C:\Users\pc\Documents\projects\DMR-X\apps\gateway"
bun src/main.ts 2>&1 | Out-File -FilePath "C:\Users\pc\Documents\projects\DMR-X\gateway-full.log" -Encoding utf8
