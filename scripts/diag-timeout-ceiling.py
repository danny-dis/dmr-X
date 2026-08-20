"""Locate the real ~60s ceiling on long agent requests.

Observed: a 64KB agent prompt died at 59.7s with RemoteDisconnected, even
though DMRX_REQUEST_TIMEOUT=120000 is set in the running process. So the cap
is NOT fastify's requestTimeout.

Candidates: keepAliveTimeout (65s), an undici/fetch default on the outbound
adapter leg, or a provider-side idle cut. This distinguishes them by timing
requests that are SLOW but SMALL, so payload size is not a factor.
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


def timed(label, body, timeout=400):
    payload = json.dumps(body).encode()
    req = urllib.request.Request(GW + f"/v1/agents/{AGENT}/chat",
                                 data=payload, headers=H, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.load(r)
            el = time.time() - t0
            print(f"  {label:<30} OK   {el:6.1f}s  tokens={d.get('totalTokens',0)}")
            return el, True
    except Exception as e:
        el = time.time() - t0
        print(f"  {label:<30} FAIL {el:6.1f}s  {type(e).__name__}: {str(e)[:70]}")
        return el, False


print("Small payload, LONG generation — isolates time from size\n")

# Force a long single generation with a big max_tokens ask.
timed("long gen, maxSteps=1", {
    "messages": [{"role": "user", "content":
                  "Write an extremely detailed 3000-word technical essay on "
                  "distributed consensus algorithms. Be exhaustive."}],
    "maxSteps": 1,
})

# Multi-step loop: many sequential upstream calls, each small.
timed("multi-step loop, maxSteps=6", {
    "messages": [{"role": "user", "content":
                  "Think step by step. Count from 1 to 6, and after each number "
                  "explain one property of TCP in two sentences."}],
    "maxSteps": 6,
})

# Repeat the 64KB case to confirm the cliff time is stable.
filler = ("The quick brown fox jumps over the lazy dog. " * 25)[:1024]
timed("64KB payload (repeat)", {
    "messages": [{"role": "user", "content":
                  "Summarize these notes in one sentence.\n\n" + filler * 64}],
    "maxSteps": 1,
})

print("\nIf failures cluster near 60s regardless of payload size, the cap is a")
print("fixed server/socket timeout, not model latency or body size.")
