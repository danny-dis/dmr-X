#!/usr/bin/env python3
"""Minimal MCP SSE client tester for DMR-X MCP server."""
import json, sys, time, urllib.request, urllib.error, threading

BASE = "http://127.0.0.1:3100"
KEY = "test-mcp-key"
HEADERS = {"Authorization": f"Bearer {KEY}"}

def post_json(payload, session=None, msg_id=None):
    data = json.dumps(payload).encode()
    h = {"Content-Type": "application/json", **HEADERS}
    if session:
        h["Mcp-Session-Id"] = session
    req = urllib.request.Request(f"{BASE}/messages?sessionId={session}", data=data, headers=h, method="POST")
    try:
        r = urllib.request.urlopen(req, timeout=60)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def open_sse():
    """Open SSE stream, return (session_id, endpoint, queue)."""
    h = {"accept": "text/event-stream", **HEADERS}
    req = urllib.request.Request(f"{BASE}/sse", headers=h)
    resp = urllib.request.urlopen(req, timeout=120)
    q = []
    session = [None]
    endpoint = [f"{BASE}/messages"]
    def reader():
        buf = ""
        for line in resp:
            line = line.decode(errors="replace")
            if line.startswith("event:"):
                buf = "event:" + line[6:].strip() + "\n"
            elif line.startswith("data:"):
                buf += "data:" + line[5:].strip() + "\n"
                if buf.strip():
                    q.append(buf)
                    raw = buf.split("data:")[1].strip() if "data:" in buf else ""
                    # endpoint event: "data: /messages?sessionId=XXX"
                    if raw.startswith("/messages"):
                        from urllib.parse import urlparse, parse_qs
                        sess = parse_qs(urlparse(raw).query).get("sessionId", [None])[0]
                        if sess:
                            session[0] = sess
                        endpoint[0] = BASE + raw
                    buf = ""
            elif line.strip() == "":
                buf = ""
    t = threading.Thread(target=reader, daemon=True)
    t.start()
    # wait for session id
    for _ in range(50):
        if session[0]:
            break
        time.sleep(0.2)
    return session[0], endpoint[0], q

def wait_result(q, msg_id, timeout=60):
    for _ in range(timeout * 5):
        for ev in list(q):
            if "data:" in ev:
                try:
                    d = json.loads(ev.split("data:")[1].strip())
                    if d.get("id") == msg_id:
                        q.remove(ev)
                        return d
                except Exception:
                    pass
        time.sleep(0.2)
    return None

def main():
    session, endpoint, q = open_sse()
    print("SESSION:", session)
    if not session:
        print("FAILED to get session"); sys.exit(1)
    # initialize
    rid = 1
    post_json({"jsonrpc":"2.0","id":rid,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"tester","version":"1.0"}}}, session)
    init = wait_result(q, rid)
    print("INIT:", (init or {}).get("result", {}).get("serverInfo"))
    # send initialized notification
    post_json({"jsonrpc":"2.0","method":"notifications/initialized"}, session)
    # tools/list
    rid = 2
    post_json({"jsonrpc":"2.0","id":rid,"method":"tools/list","params":{}}, session)
    tl = wait_result(q, rid)
    tools = (tl or {}).get("result", {}).get("tools", [])
    print(f"TOOLS ({len(tools)}):", [t["name"] for t in tools])
    # call each requested tool
    calls = {
        "dmrx_chat": {"messages":[{"role":"user","content":"Reply with the single word PONG"}],"max_tokens":20,"model":"openrouter-free/google/gemma-2-9b-it:free"},
        "dmrx_models": {},
        "dmrx_status": {},
        "dmrx_generate_image": {"prompt":"a red robot on a hill, sunset","model":"flux","n":1},
        "dmrx_embed": {"input":"hello world","model":"auto"},
        "dmrx_rerank": {"query":"best cat","documents":["cat sits","dog runs"],"model":"auto"},
        "dmrx_transcribe": {"audio":"","model":"auto"},
        "dmrx_speak": {"input":"hello","model":"auto"},
    }
    rid = 10
    for name, args in calls.items():
        rid += 1
        post_json({"jsonrpc":"2.0","id":rid,"method":"tools/call","params":{"name":name,"arguments":args}}, session)
        res = wait_result(q, rid, timeout=90)
        if res is None:
            print(f"  {name}: TIMEOUT")
            continue
        content = res.get("result", {}).get("content", [])
        iserr = res.get("result", {}).get("isError")
        text = ""
        for c in content:
            if c.get("type") == "text":
                text += c.get("text", "")[:300]
        print(f"  {name}: isError={iserr} -> {text[:300]}")
    print("DONE")

if __name__ == "__main__":
    main()
