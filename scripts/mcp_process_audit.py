#!/usr/bin/env python3
"""Report every DMR-X MCP process and who owns port 3100 / 47114.

A Python wrapper because inline PowerShell with $_ gets mangled by MSYS
(the shell expands $_ before PowerShell sees it).
"""
import re
import subprocess

PS = r"""
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*mcp-server*' -or $_.CommandLine -like '*dmrx-alwayson*' } |
  ForEach-Object { "{0}|{1}|{2}|{3}" -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate, $_.CommandLine }
"""

out = subprocess.run(["powershell", "-NoProfile", "-Command", PS],
                     capture_output=True, text=True, timeout=90).stdout

print("=== DMR-X MCP / watchdog processes ===")
for line in out.splitlines():
    if "|" not in line:
        continue
    parts = line.split("|", 3)
    if len(parts) < 4:
        continue
    pid, ppid, created, cmd = parts
    kind = "watchdog" if "alwayson" in cmd else ("dist" if "dist" in cmd else "src")
    print("  pid=%-6s ppid=%-6s %-9s %s" % (pid.strip(), ppid.strip(), kind, created.strip()[:24]))

net = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, timeout=60).stdout
print("\n=== listeners ===")
for line in net.splitlines():
    if ("127.0.0.1:3100 " in line or "127.0.0.1:47114 " in line) and "LISTENING" in line:
        m = re.search(r":(\d+)\s.*LISTENING\s+(\d+)", line)
        if m:
            print("  port %-6s -> pid %s" % (m.group(1), m.group(2)))
