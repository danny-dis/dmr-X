import json, urllib.request

MCP = "http://127.0.0.1:47114/mcp"
session = None
rid = 0

def rpc(method, params=None, notify=False):
    global rid, session
    rid += 1
    payload = {"jsonrpc": "2.0", "method": method}
    if params is not None: payload["params"] = params
    if not notify: payload["id"] = rid
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if session: headers["Mcp-Session-Id"] = session
    req = urllib.request.Request(MCP, data=json.dumps(payload).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            sid = r.headers.get("mcp-session-id")
            if sid: globals()["session"] = None or sid
            raw = r.read().decode(errors="replace")
    except Exception as e:
        return {"error": str(e)[:200]}
    # body may be SSE
    data_lines = [l[5:].strip() for l in raw.splitlines() if l.startswith("data:")]
    if data_lines:
        try: return json.loads(data_lines[-1])
        except Exception: return {"raw": raw[:300]}
    try: return json.loads(raw)
    except Exception: return {"raw": raw[:300]}

print("== initialize ==")
r = rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                       "clientInfo": {"name": "hermes-test", "version": "1"}})
print(json.dumps(r.get("result", r), indent=None)[:400])
print("session:", session)
rpc("notifications/initialized", {}, notify=True)

print("\n== tools/list ==")
r = rpc("tools/list", {})
tools = r.get("result", {}).get("tools", [])
print(f"{len(tools)} tools:", ", ".join(t["name"] for t in tools)[:500])

# pick a safe read-only tool to call
if tools:
    target = None
    for t in tools:
        n = t["name"].lower()
        if any(k in n for k in ("list", "health", "models", "agents", "providers")):
            target = t; break
    if target is None: target = tools[0]
    print(f"\n== calling tool: {target['name']} ==")
    schema = target.get("inputSchema", {})
    args = {}
    for prop, spec in (schema.get("properties") or {}).items():
        if prop in (schema.get("required") or []):
            args[prop] = spec.get("default") if spec.get("default") is not None else (
                5 if spec.get("type") == "number" else "test")
    r = rpc("tools/call", {"name": target["name"], "arguments": args})
    res = r.get("result", {})
    texts = [c.get("text","") for c in res.get("content", []) if c.get("type")=="text"]
    out = "\n".join(texts)[:600]
    print("isError:", res.get("isError"), "| output head:\n", out)
