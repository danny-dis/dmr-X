# DMR-X Auto-Start & Windows Service / Scheduled Task Register
# Ensures DMR-X Gateway, MCP, A2A, and Godmode start cleanly and always boot up with Windows.

$ErrorActionPreference = 'Continue'
$ProjectRoot = "C:\Users\pc\Documents\projects\DMR-X"
$ScriptPath = Join-Path $ProjectRoot "scripts\dmrx-alwayson.ps1"

Write-Host "===================================================="
Write-Host " DMR-X Auto-Start Setup (Gateway + MCP + A2A + Godmode)"
Write-Host "===================================================="

# 1. Scheduled Task Registration (User level fallback if non-admin)
Unregister-ScheduledTask -TaskName "DMR-X-Gateway" -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory "$ProjectRoot"

$triggerLogon = New-ScheduledTaskTrigger -AtLogon
$triggerStartup = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

$registered = $false

# Try registering elevated task
try {
    Register-ScheduledTask -TaskName "DMR-X-Gateway" `
        -Action $action `
        -Trigger @($triggerLogon, $triggerStartup) `
        -Settings $settings `
        -RunLevel Highest `
        -Description "DMR-X Gateway + MCP + A2A + Godmode Always-On Launcher" `
        -Force -ErrorAction Stop | Out-Null
    Write-Host "[+] Scheduled Task 'DMR-X-Gateway' registered with Highest privileges."
    $registered = $true
} catch {
    Write-Host "[!] Admin privileges not available for Highest runlevel. Trying User-level task..."
    try {
        Register-ScheduledTask -TaskName "DMR-X-Gateway" `
            -Action $action `
            -Trigger $triggerLogon `
            -Settings $settings `
            -Description "DMR-X Gateway + MCP + A2A + Godmode Always-On Launcher" `
            -Force -ErrorAction Stop | Out-Null
        Write-Host "[+] Scheduled Task 'DMR-X-Gateway' registered at User level."
        $registered = $true
    } catch {
        Write-Host "[!] Scheduled Task registration skipped ($($_.Exception.Message))."
    }
}

# 2. Windows Startup Folder Shortcut / VBS (Guaranteed Boot Persistence)
$startupFolder = [System.IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs\Startup')
$vbsPath = Join-Path $startupFolder "DMR-X-AutoStart.vbs"

$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$ScriptPath""", 0, False
"@

try {
    Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII
    Write-Host "[+] Windows Startup launcher created at:"
    Write-Host "    $vbsPath"
} catch {
    Write-Host "[!] Could not write to Startup folder: $($_.Exception.Message)"
}

Write-Host "----------------------------------------------------"
Write-Host "DMR-X Auto-Start configuration complete!"
Write-Host "Components configured for auto-start:"
Write-Host "  - Gateway   (Port 47113)"
Write-Host "  - MCP Server(Port 3100)"
Write-Host "  - A2A Engine(Port 3100 / a2a routes enabled)"
Write-Host "  - Godmode   (Port 7860)"
Write-Host "===================================================="
