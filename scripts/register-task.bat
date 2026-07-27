@echo off
REM Run this as Administrator to register the DMR-X launcher task
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "Unregister-ScheduledTask -TaskName 'DMR-X-Gateway' -Confirm:$false -ErrorAction SilentlyContinue; ^
   Register-ScheduledTask -TaskName 'DMR-X-Gateway' -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\Users\pc\Documents\projects\DMR-X\scripts\dmrx-alwayson.ps1' -WorkingDirectory 'C:\Users\pc\Documents\projects\DMR-X') -Trigger (New-ScheduledTaskTrigger -AtLogon),(New-ScheduledTaskTrigger -AtStartup) -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew) -RunLevel Highest -Force"
echo.
echo Task registered. It will start on next logon.
echo.
pause