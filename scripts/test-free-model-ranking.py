import json, time, urllib.request, urllib.error, concurrent.futures

BASE = "http://127.0.0.1:47113"
MODELS = [
    "opencode-zen/deepseek-v4-flash-free",
    "opencode-zen/nemotron-3-ultra-free",
    "openrouter-free/google/gemma-4-31b-it:free",
    "openrouter-free/z-ai/glm-5.2:free",
    "tokenrouter/qwen/qwen3.8-max-free",
    "openrouter-free/nvidia/nemotron-3-super-120b-a12b:free",
    "openrouter-free/nvidia/nemotron-3-ultra-550b-a55b:free",
    "openrouter-free/thinkingmachines/inkling:free",
    "opencode-zen/mimo-v2.5-free",
    "openrouter-free/cohere/north-mini-code:free",
    "opencode-zen/laguna-s-2.1-free",
    "opencode-zen/hy3-free",
]

TASKS = [
    {"name": "math", "prompt": "A train travels 60 km in 45 minutes. What is its speed in km/h? Reply with ONLY the number.",
     "check": lambda t: "80" in t.replace(",", "")},
    {"name": "instruction", "prompt": "Reply with exactly this JSON and nothing else: {\"status\":\"ok\",\"n\":7}",
     "check": lambda t: '"ok"' in t and "7" in t},
    {"name": "code", "prompt": "Write a Python function `def is_pal(s)` that returns True if string s is a palindrome. Reply with code only.",
     "check": lambda t: "def is_pal" in t},
]

def chat(model, prompt, timeout=90):
    req = urllib.request.Request(BASE + "/v1/chat/completions",
        data=json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}],
                         "max_tokens": 300}).encode(),
        headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = json.loads(r.read().decode())
        content = ""
        try: content = b["choices"][0]["message"]["content"] or ""
        except Exception: pass
        fb = b.get("dmrx_fallback") or {}
        served_model = b.get("model", "?")
        return {"ok": True, "ms": int((time.time()-t0)*1000), "content": content,
                "served_as": served_model, "attempts": fb.get("attempts", 1)}
    except urllib.error.HTTPError as e:
        return {"ok": False, "ms": int((time.time()-t0)*1000), "err": f"HTTP {e.code}"}
    except Exception as e:
        return {"ok": False, "ms": int((time.time()-t0)*1000), "err": str(e)[:100]}

results = []
for m in MODELS:
    row = {"model": m, "tasks": {}, "latencies": [], "direct_hits": 0}
    for t in TASKS:
        r = chat(m, t["prompt"])
        if r["ok"]:
            passed = False
            try: passed = bool(t["check"](r["content"]))
            except Exception: pass
            row["tasks"][t["name"]] = {"pass": passed, "ms": r["ms"], "served_as": r["served_as"], "attempts": r["attempts"]}
            row["latencies"].append(r["ms"])
            if r["served_as"].split("/")[-1] == m.split("/")[-1] and r["attempts"] == 1:
                row["direct_hits"] += 1
            else:
                # still counts if served model matches family even w/ attempts
                pass
        else:
            row["tasks"][t["name"]] = {"pass": False, "err": r.get("err"), "ms": r["ms"]}
    results.append(row)
    p = sum(1 for v in row["tasks"].values() if v.get("pass"))
    avg = sum(row["latencies"])//len(row["latencies"]) if row["latencies"] else -1
    print(f"{m:55} pass={p}/3 avg={avg}ms direct={row['direct_hits']}/3")

print("\n=== DETAILS ===")
print(json.dumps(results, indent=1))
