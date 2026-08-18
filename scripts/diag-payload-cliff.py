"""Find the request-size threshold where agent calls drop the socket.

Evidence: in a serial job, tasks 1-3 completed cleanly (att=0), but task 4 —
which concatenates the outputs of 1-3 into its prompt — failed 3x with
"The socket connection was closed unexpectedly" (error code 0, not an HTTP
status, so not a provider rejection).

This sends escalating prompt sizes to one agent to locate the cliff.
"""
import json, os, re, time, urllib.request, urllib.error

GW = "http://localhost:47113"
ENV = os.path.join(os.path.dirname(__file__), "..", ".env")
KEY = next(
    (m.group(1) for line in open(ENV, encoding="utf-8", errors="ignore")
     if (m := re.match(r"^DMRX_ADMIN_API_KEY=(.+)$", line.strip()))),
    "",
)
H = {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
AGENT = "e50d3da0-22b9-4e7d-9b0b-09852883029b"

# Roughly 4 chars per token.
SIZES_KB = [1, 4, 16, 32, 64, 128, 256]


def probe(kb):
    filler = ("The quick brown fox jumps over the lazy dog. " * 25)[:1024]
    content = (
        "Summarize the following notes in one short sentence.\n\n"
        + filler * kb
    )
    body = {"messages": [{"role": "user", "content": content}], "maxSteps": 1}
    payload = json.dumps(body).encode()
    req = urllib.request.Request(GW + f"/v1/agents/{AGENT}/chat",
                                 data=payload, headers=H, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            d = json.load(r)
            return ("OK", r.status, len(payload), d.get("totalTokens", 0), time.time() - t0, "")
    except urllib.error.HTTPError as e:
        try:
            msg = json.dumps(json.load(e))[:120]
        except Exception:
            msg = e.read()[:120].decode("utf8", "replace")
        return ("HTTP", e.code, len(payload), 0, time.time() - t0, msg)
    except Exception as e:
        return ("DROP", 0, len(payload), 0, time.time() - t0, repr(e)[:120])


print(f"agent {AGENT}\n")
print(f"{'payload':>10}  {'result':<6} {'code':>5} {'tokens':>8} {'secs':>6}  detail")
print("-" * 78)
for kb in SIZES_KB:
    kind, code, nbytes, tokens, secs, detail = probe(kb)
    print(f"{nbytes/1024:9.0f}K  {kind:<6} {code:>5} {tokens:>8} {secs:6.1f}  {detail}")
    if kind == "DROP":
        print(f"\n>>> socket dropped at ~{nbytes/1024:.0f}KB payload")
        print(">>> matches the task-4 failure: large assembled prompt kills the request")
        break
else:
    print("\nno drop up to the largest size tested")
