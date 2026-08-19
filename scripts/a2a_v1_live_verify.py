#!/usr/bin/env python3
"""Live A2A v1.0 verification against the running MCP server.

Written as a FILE (not an inline heredoc) because git-bash mangles JSON quoting
in curl -d and produces false -32700 parse errors.
"""
import json
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:47114"


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=15) as r:
        return json.loads(r.read())


def rpc(method, params=None):
    body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}
    }).encode()
    req = urllib.request.Request(
        BASE + "/a2a", data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"_http": e.code, "body": e.read().decode(errors="replace")[:300]}


fails = []

# --- 1. Agent card dual shape ---
card = get("/.well-known/agent-card.json")
print("=== AGENT CARD ===")
print("legacy protocolVersion :", card.get("protocolVersion"))
print("legacy url             :", card.get("url"))
print("legacy preferredTransport:", card.get("preferredTransport"))
print("supportedInterfaces    :", json.dumps(card.get("supportedInterfaces")))
print("skills                 :", len(card.get("skills", [])))
print("iconUrl present        :", "iconUrl" in card)

si = card.get("supportedInterfaces")
if not isinstance(si, list) or not si:
    fails.append("supportedInterfaces missing/empty")
else:
    p = si[0]
    if p.get("protocolVersion") != "1.0":
        fails.append("primary protocolVersion != '1.0' (got %r)" % p.get("protocolVersion"))
    if p.get("protocolBinding") != "JSONRPC":
        fails.append("primary protocolBinding != JSONRPC")
    if p.get("url") != card.get("url"):
        fails.append("primary url != legacy url")
    if "tenant" in p:
        fails.append("tenant emitted despite not being configured")

if card.get("protocolVersion") != "0.3.0":
    fails.append("legacy protocolVersion regressed (got %r)" % card.get("protocolVersion"))
if "iconUrl" in card:
    fails.append("iconUrl emitted despite empty-string default (truthiness guard broken)")
if len(card.get("skills", [])) < 300:
    fails.append("skill count dropped to %d (expected ~323)" % len(card.get("skills", [])))

# legacy alias must serve the same shape
alias = get("/.well-known/agent.json")
if alias.get("supportedInterfaces") != si:
    fails.append("/.well-known/agent.json alias disagrees with agent-card.json")

# --- 2. tasks/list ---
print("\n=== tasks/list ===")
r = rpc("tasks/list", {"pageSize": 5})
print("ok:", "result" in r, "| keys:", list(r.get("result", {}).keys()) if "result" in r else r)
if "result" not in r or "tasks" not in r.get("result", {}):
    fails.append("tasks/list did not return result.tasks: %s" % json.dumps(r)[:200])

bad = rpc("tasks/list", {"pageSize": 5000})
print("pageSize=5000 ->", bad.get("error", {}).get("code"))
if bad.get("error", {}).get("code") != -32602:
    fails.append("tasks/list pageSize=5000 should be -32602, got %s" % json.dumps(bad)[:200])

# --- 3. agent/getExtendedCard ---
print("\n=== agent/getExtendedCard ===")
ext = rpc("agent/getExtendedCard")
if "result" in ext:
    print("name:", ext["result"].get("name"))
    print("has supportedInterfaces:", "supportedInterfaces" in ext["result"])
    if "supportedInterfaces" not in ext["result"]:
        fails.append("extended card lacks supportedInterfaces")
else:
    print("ERROR:", json.dumps(ext)[:250])
    fails.append("agent/getExtendedCard failed: %s" % json.dumps(ext)[:200])

alias2 = rpc("agent/authenticatedExtendedCard")
if "result" not in alias2:
    fails.append("authenticatedExtendedCard alias failed")

# --- 4. regression: unknown method still -32601 ---
unk = rpc("tasks/definitelyNotAMethod")
if unk.get("error", {}).get("code") != -32601:
    fails.append("unknown method should be -32601, got %s" % json.dumps(unk)[:150])

# --- 5. regression: 0.3.0 message/send still works (kind:text + messageId) ---
print("\n=== message/send (0.3.0 regression) ===")
send = rpc("message/send", {
    "message": {
        "messageId": "m-verify-1",
        "role": "user",
        "parts": [{"kind": "text", "text": "What is 2+2? Reply with just the number."}],
    }
})
state = send.get("result", {}).get("status", {}).get("state")
text = ""
try:
    text = send["result"]["status"]["message"]["parts"][0].get("text", "")
except Exception:
    pass
print("state:", state, "| answer len:", len(text), "| answer:", text[:80])
if state not in ("completed", "failed", "canceled", "rejected"):
    fails.append("message/send returned unexpected state %r" % state)
if state == "completed" and not text.strip():
    fails.append("message/send completed with EMPTY text (known failure mode)")

print("\n" + "=" * 50)
if fails:
    print("FAILURES (%d):" % len(fails))
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("ALL LIVE CHECKS PASSED")
