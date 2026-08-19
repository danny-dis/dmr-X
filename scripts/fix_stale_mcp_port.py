#!/usr/bin/env python3
"""Replace the stale MCP port default (3100 -> 47114) across DMR-X source.

Written as a file because the `||` in the target expressions gets eaten by
bash/MSYS when passed inline to sed.

Only DEFAULTS change: every site keeps reading DMRX_MCP_PORT first, so an
explicit env var still wins. 3100 was the historical default; the server has
listened on 47114 since 2026-08-11 and the mismatch caused the gateway sidecar
to start a SECOND MCP instance on 3100 alongside the PM2 one on 47114.
"""
import pathlib
import sys

ROOT = pathlib.Path("C:/Users/pc/Documents/projects/DMR-X")

EDITS = [
    ("services/mcp-server/src/config.ts", '*   "port": 3100,', '*   "port": 47114,'),
    ("services/mcp-server/src/resources.ts",
     "process.env.DMRX_MCP_PORT || '3100'", "process.env.DMRX_MCP_PORT || '47114'"),
    ("apps/gateway/src/routes/a2a-proxy.routes.ts",
     "// :3100. A browser", "// :47114. A browser"),
    ("apps/gateway/src/routes/a2a-proxy.routes.ts",
     "process.env.DMRX_MCP_PORT || '3100'", "process.env.DMRX_MCP_PORT || '47114'"),
    ("apps/gateway/src/routes/admin.routes.ts",
     "process.env.DMRX_MCP_PORT || '3100'", "process.env.DMRX_MCP_PORT || '47114'"),
    ("apps/gateway/src/routes/admin.routes.ts",
     "String(fileConfig.port || 3100)", "String(fileConfig.port || 47114)"),
    ("apps/gateway/src/routes/tools.routes.ts",
     "process.env.DMRX_MCP_PORT || '3100'", "process.env.DMRX_MCP_PORT || '47114'"),
]

total = 0
for rel, old, new in EDITS:
    p = ROOT / rel
    txt = p.read_text(encoding="utf-8")
    n = txt.count(old)
    if n == 0:
        print("SKIP (already done or not found): %s :: %s" % (rel, old[:50]))
        continue
    p.write_text(txt.replace(old, new), encoding="utf-8")
    total += n
    print("OK  %-52s x%d" % (rel, n))

print("\ntotal replacements: %d" % total)

# Verify nothing is left
leftover = []
for rel in {e[0] for e in EDITS}:
    txt = (ROOT / rel).read_text(encoding="utf-8")
    for i, line in enumerate(txt.splitlines(), 1):
        if "3100" in line:
            leftover.append("%s:%d: %s" % (rel, i, line.strip()[:90]))

if leftover:
    print("\nREMAINING 3100 REFERENCES:")
    for l in leftover:
        print("  " + l)
    sys.exit(1)
print("\nclean: no 3100 left in the edited files")
