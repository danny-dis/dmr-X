$env:DMRX_LOCAL_MODE = "true"
$env:PORT = "3000"
Set-Location "C:\Users\pc\Documents\projects\DMR-X\apps\gateway"

# Start bun as a background job
$proc = Start-Process -FilePath "bun" -ArgumentList "src/main.ts" -NoNewWindow -PassThru -RedirectStandardOutput "C:\Users\pc\Documents\projects\DMR-X\gw-stdout.log" -RedirectStandardError "C:\Users\pc\Documents\projects\DMR-X\gw-stderr.log"

# Wait and poll for health
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 2
    if ($proc.HasExited) {
        Write-Host "Process exited with code: $($proc.ExitCode)"
        Get-Content "C:\Users\pc\Documents\projects\DMR-X\gw-stderr.log" -ErrorAction SilentlyContinue | Select-Object -Last 10
        break
    }
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000/health" -TimeoutSec 2 -ErrorAction Stop
        Write-Host "[$i] Health OK: $($response.Content)"
        break
    } catch {
        if ($i -eq 20) {
            Write-Host "[$i] Still not ready after 40s"
            Get-Content "C:\Users\pc\Documents\projects\DMR-X\gw-stdout.log" -ErrorAction SilentlyContinue | Select-Object -Last 10
        } else {
            Write-Host "[$i] Waiting..." -NoNewline
        }
    }
}
