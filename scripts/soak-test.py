#!/usr/bin/env python3
"""9-call / 90s soak test for DMR-X gateway stability."""
import json, time, urllib.request, sys

GW = "http://127.0.0.1:47113"
MODEL = "auto-coding"
TOTAL = 9
INTERVAL = 10  # 9 calls over ~90s

def call_model():
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role":"user","content":"Say hello in one sentence."}],
        "max_tokens": 50
    }).encode()
    req = urllib.request.Request(f"{GW}/v1/chat/completions", data=body, headers={"Content-Type":"application/json"})
    try:
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
            dt = time.time() - t0
            usage = data.get("usage",{})
            content = data.get("choices",[{}])[0].get("message",{}).get("content","")
            model_used = data.get("model","?")
            return {"ok": True, "dt": round(dt,2), "model": model_used, "content_len": len(content), "tokens": usage.get("total_tokens",0)}
    except Exception as e:
        return {"ok": False, "error": str(e)[:120]}

print(f"Soak test: {TOTAL} calls to {MODEL} over ~{TOTAL*INTERVAL}s")
print("="*60)
results = []
for i in range(TOTAL):
    r = call_model()
    results.append(r)
    tag = "OK" if r["ok"] else "FAIL"
    if r["ok"]:
        print(f"  [{i+1}/{TOTAL}] {tag}  {r['dt']:>5.1f}s  model={r['model']:<25}  content={r['content_len']}B  tokens={r['tokens']}")
    else:
        print(f"  [{i+1}/{TOTAL}] {tag}  {r['error']}")
    if i < TOTAL-1:
        time.sleep(INTERVAL)

oks = sum(1 for r in results if r["ok"])
print("="*60)
print(f"Result: {oks}/{TOTAL} succeeded")
if oks == TOTAL:
    print("PASS - all calls returned 200")
    sys.exit(0)
else:
    print("FAIL - some calls failed")
    sys.exit(1)
