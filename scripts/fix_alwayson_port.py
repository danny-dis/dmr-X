#!/usr/bin/env python3
"""Point the dmrx-alwayson watchdog's health checks at :47114, not :3100.

Written as a file because MSYS mangles inline PowerShell/sed quoting.

The port env was already switched to 47114, but Test-PortListen still probed
3100 in three places. Left as-is the watchdog would see MCP as DOWN on every
tick and respawn it in a loop — the exact failure this pass is meant to remove.
Comment references are updated too so the file doesn't document the old split.
"""
import pathlib
import sys

P = pathlib.Path("C:/Users/pc/Documents/projects/DMR-X/scripts/dmrx-alwayson.ps1")
txt = P.read_text(encoding="utf-8")
orig = txt

# 1. Live health probes — the load-bearing fix.
txt = txt.replace("Test-PortListen 3100", "Test-PortListen 47114")

# 2. Log line + header/comment references to the old port.
txt = txt.replace(
    'Write-Log "Companions healthy (MCP+A2A :3100, G0DM0D3 :7860)"',
    'Write-Log "Companions healthy (MCP+A2A :47114, G0DM0D3 :7860)"',
)
txt = txt.replace(
    "# Keeps the gateway running and the MCP+A2A (:3100) and G0DM0D3 (:7860)",
    "# Keeps the gateway running and the MCP+A2A (:47114) and G0DM0D3 (:7860)",
)
txt = txt.replace(
    "# ours. Companion ports (3100 / 7860) are deliberately NOT cleared here: the",
    "# ours. Companion ports (47114 / 7860) are deliberately NOT cleared here: the",
)

if txt == orig:
    print("no changes needed")
    sys.exit(0)

P.write_text(txt, encoding="utf-8")

remaining = [
    "%d: %s" % (i, l.strip()[:95])
    for i, l in enumerate(txt.splitlines(), 1)
    if "3100" in l
]
print("probes now on 47114: %d" % txt.count("Test-PortListen 47114"))
if remaining:
    print("\nremaining 3100 mentions (should be historical comments only):")
    for r in remaining:
        print("  " + r)
