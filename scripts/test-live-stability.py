import json, time, urllib.request, urllib.error, concurrent.futures

BASE = "http://127.0.0.1:47113"

def post(path, payload, timeout=90):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return {"ok": True, "ms": int((time.time()-t0)*1000), "body": json.loads(r.read().decode())}
    except urllib.error.HTTPError as e:
        try: detail = e.read().decode()[:150]
        except Exception: detail = ""
        return {"ok": False, "ms": int((time.time()-t0)*1000), "err": f"HTTP {e.code}: {detail}"}
    except Exception as e:
        return {"ok": False, "ms": int((time.time()-t0)*1000), "err": str(e)[:200]}

def one_chat(i=None):
    res = post("/v1/chat/completions", {
        "model": "auto",
        "messages": [{"role": "user", "content": f"Reply with exactly the word PONG{i or ''}"}],
        "max_tokens": 60})
    if not res["ok"]:
        return {"i": i, "ok": False, "ms": res["ms"], "err": res["err"]}
    b = res["body"]
    try: content = b["choices"][0]["message"]["content"]
    except Exception: content = ""
    fb = b.get("dmrx_fallback") or {}
    return {"i": i, "ok": True, "ms": res["ms"], "model": b.get("model", "?"),
            "content": content.strip()[:30], "attempts": fb.get("attempts", 1)}

print("=== TEST 1: single basic completion ===")
r = one_chat()
print(json.dumps(r))

print("\n=== TEST 2: streaming ===")
req = urllib.request.Request(BASE + "/v1/chat/completions",
    data=json.dumps({"model":"auto","messages":[{"role":"user","content":"Count 1 to 5"}],"max_tokens":60,"stream":True}).encode(),
    headers={"Content-Type":"application/json"})
t0 = time.time(); chunks = 0; first_ms = None
try:
    with urllib.request.urlopen(req, timeout=90) as resp:
        for line in resp:
            line = line.decode(errors="replace").strip()
            if line.startswith("data:") and "[DONE]" not in line:
                chunks += 1
                if first_ms is None: first_ms = int((time.time()-t0)*1000)
except Exception as e:
    print("stream err:", str(e)[:150])
print(f"chunks={chunks} first_chunk={first_ms}ms total={int((time.time()-t0)*1000)}ms")

print("\n=== TEST 3: concurrency (8 parallel) ===")
with concurrent.futures.ThreadPoolExecutor(8) as ex:
    results = list(ex.map(one_chat, range(8)))
oks = [r for r in results if r["ok"]]
print(f"success {len(oks)}/8 | avg {sum(r['ms'] for r in results)//8}ms | max {max(r['ms'] for r in results)}ms")
for r in results:
    if not r["ok"]: print("  FAIL:", r["i"], r["err"])
models = {}
for r in oks: models[r.get("model","?")] = models.get(r.get("model","?"),0)+1
print("models used:", json.dumps(models))
multi = sum(1 for r in oks if r.get("attempts",1) > 1)
print(f"requests needing fallback attempts: {multi}/{len(oks)}")
