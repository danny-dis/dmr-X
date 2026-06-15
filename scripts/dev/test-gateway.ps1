$env:DMRX_LOCAL_MODE = "true"
$env:PORT = "3000"
Set-Location "C:\Users\pc\Documents\projects\DMR-X\apps\gateway"
$proc = Start-Process -FilePath "bun" -ArgumentList "src/main.ts" -NoNewWindow -PassThru -RedirectStandardError "C:\Users\pc\Documents\projects\DMR-X\gateway-err2.log"
Start-Sleep -Seconds 30
# Check if process is still alive
if (!$proc.HasExited) {
    Write-Host "Server still running (PID: $($proc.Id))"
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000/health" -TimeoutSec 5
        Write-Host "Health: $($response.Content)"
    } catch {
        Write-Host "Health check failed: $($_.Exception.Message)"
    }
} else {
    Write-Host "Process exited with code: $($proc.ExitCode)"
    Get-Content "C:\Users\pc\Documents\projects\DMR-X\gateway-err2.log" -ErrorAction SilentlyContinue
}
