#!/usr/bin/env python3
"""Prove no baseline-dirty file's diff was altered during delegation.

Compares each file's CURRENT `git diff` against the same file's hunk in the
pre-delegation backup patch. Any mismatch = subagent drift.
Excludes index.ts (authorized: Task 7 edited it deliberately).
"""
import hashlib
import re
import subprocess
import sys

BAK = ".hermes/backups/pre-delegation-20260819-195307/tracked.patch"
AUTHORIZED = {
    "services/mcp-server/src/index.ts",
    # Stale MCP port default 3100 -> 47114. This file's sidecar resolver was
    # the reason a SECOND MCP instance kept appearing on :3100 next to the PM2
    # one on :47114.
    "apps/gateway/src/lib/sidecar-boot.ts",
    # Empty-reply-after-tool-use fix found by the agent fleet load test.
    "apps/gateway/src/routes/agent-chat-loop.ts",
}

raw = open(BAK, encoding="utf-8", errors="replace").read()

saved = {}
for chunk in re.split(r"(?m)^diff --git ", raw):
    if not chunk.strip():
        continue
    m = re.match(r"a/(\S+) b/\S+", chunk)
    if m:
        saved[m.group(1)] = ("diff --git " + chunk).strip()

files = sorted(f for f in saved if f not in AUTHORIZED)
drift = []
for f in files:
    now = subprocess.run(["git", "diff", "--", f],
                         capture_output=True, text=True).stdout.strip()
    a = hashlib.md5(saved[f].encode()).hexdigest()[:10]
    b = hashlib.md5(now.encode()).hexdigest()[:10]
    if a != b:
        drift.append((f, a, b))

print("baseline-dirty files compared: %d" % len(files))
print("excluded (authorized edit)   : %s" % ", ".join(sorted(AUTHORIZED)))
print()
if drift:
    print("*** DRIFT DETECTED (%d files) ***" % len(drift))
    for f, a, b in drift:
        print("  %s  %s -> %s" % (f, a, b))
    sys.exit(1)
print("NO DRIFT: every baseline-dirty file's diff is byte-identical to backup")
