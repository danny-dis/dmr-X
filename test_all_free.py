import urllib.request, json, time

keys = {
    "BETTY/BYTE/FAEY": "sk-84xSo2kEXgRmx5GBnmyCTdABHR5bFHp8jjR3AjYCPI8q7HkVvAnCnVqSdWNK3EZY",
    "NOCTURNE": "sk-lIVHkjMJV2Scml69JJ5m4RI6G5W2efximXIwvhfONZBiWhoZRAkPFuhxo9WbUHtD",
    "kallmedis": "sk-Iep2A6KPw3VnX6vwVi3mj6IwOZdnnLXWzasZQdHz2nYkJCbp",
}

free_models = [
    "deepseek-v4-flash-free",
    "hy3-free",
    "laguna-s-2.1-free",
    "mimo-v2.5-free",
    "nemotron-3-ultra-free",
    "nemotron-3.5-lightning-free",
]

results = {}
for label, key in keys.items():
    print(f"\n=== {label} ===")
    for model in free_models:
        try:
            body = json.dumps({"model": model, "messages":[{"role":"user","content":"ping"}],"max_tokens":5}).encode()
            req = urllib.request.Request("https://opencode.ai/zen/v1/chat/completions", data=body, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                d = json.loads(resp.read().decode())
                if "error" in d:
                    err_type = d.get("error",{}).get("type","?")
                    results.setdefault(model, {})[label] = f"❌ {err_type}"
                    print(f"  {model:35s} ❌ {err_type}")
                else:
                    content = d.get("choices",[{}])[0].get("message",{}).get("content","")[:40]
                    results.setdefault(model, {})[label] = f"✅"
                    print(f"  {model:35s} ✅ {content}")
        except urllib.error.HTTPError as e:
            body = e.read().decode() if e.fp else ""
            if "1010" in body:
                results.setdefault(model, {})[label] = "❌ CreditsError"
                print(f"  {model:35s} ❌ CreditsError")
            else:
                results.setdefault(model, {})[label] = f"❌ HTTP {e.code}"
                print(f"  {model:35s} ❌ HTTP {e.code}")
        except Exception as e:
            results.setdefault(model, {})[label] = f"❌ {str(e)[:30]}"
            print(f"  {model:35s} ❌ {str(e)[:30]}")
        time.sleep(1.5)

print("\n\n=== SUMMARY ===")
print(f"{'Model':35s} {'BETTY':10s} {'NOCTURNE':10s} {'kallmedis':10s}")
print("-"*75)
for model in free_models:
    row = results.get(model, {})
    print(f"{model:35s} {row.get('BETTY/BYTE/FAEY','?'):10s} {row.get('NOCTURNE','?'):10s} {row.get('kallmedis','?'):10s}")
