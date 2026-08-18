"""Isolate why job task execution fails while direct agent calls succeed.

Direct POST /v1/agents/:id/chat works (verified: PROBE_OK). Job tasks calling
the same agent fail with "All providers currently unavailable". This reproduces
the job-runner's exact call shape to find the difference.
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
AGENT = "e50d3da0-22b9-4e7d-9b0b-09852883029b"  # Developer Advocate


def post(path, body, timeout=300):
    req = urllib.request.Request(
        GW + path, data=json.dumps(body).encode(), headers=H, method="POST"
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.load(r), time.time() - t0
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e), time.time() - t0
        except Exception:
            return e.code, {"raw": e.read()[:400].decode("utf8", "replace")}, time.time() - t0
    except Exception as e:
        return 0, {"error": repr(e)[:300]}, time.time() - t0


def show(label, code, body, secs):
    if code == 200:
        txt = (body.get("content") or "")[:60].replace("\n", " ")
        print(f"  {label:<34} {code} {secs:5.1f}s tok={body.get('totalTokens',0):<7} {txt}")
    else:
        msg = json.dumps(body)[:150]
        print(f"  {label:<34} {code} {secs:5.1f}s  {msg}")


print("Agent:", AGENT, "\n")

# 1. Minimal shape (known good).
print("1. minimal — same as the passing probe")
show("messages+maxSteps", *post(f"/v1/agents/{AGENT}/chat",
     {"messages": [{"role": "user", "content": "Reply exactly: OK1"}], "maxSteps": 1}))

# 2. Exactly what job-runner sends: buildTaskMessage text, stream:false, NO maxSteps.
print("\n2. job-runner shape — stream:false, no maxSteps")
task_msg = (
    "Task: Write the Python Hello World script\n"
    "\nDescription:\nCreate a Python script named hello_world.py containing a "
    "single print statement.\n"
    "\nDeliverable:\nhello_world.py\n"
    "\nAcceptance criteria:\nFile is valid Python 3."
)
show("stream:false, no maxSteps", *post(f"/v1/agents/{AGENT}/chat",
     {"messages": [{"role": "user", "content": task_msg}], "stream": False}))

# 3. Default maxSteps (10) — the multi-turn tool loop.
print("\n3. maxSteps=10 (the route default the job path uses)")
show("maxSteps:10", *post(f"/v1/agents/{AGENT}/chat",
     {"messages": [{"role": "user", "content": task_msg}], "stream": False, "maxSteps": 10}))

# 4. Two back-to-back calls: does a second immediate call fail?
print("\n4. sequential pressure (2 rapid calls)")
for i in (1, 2):
    show(f"rapid #{i}", *post(f"/v1/agents/{AGENT}/chat",
         {"messages": [{"role": "user", "content": f"Reply exactly: SEQ{i}"}], "maxSteps": 1}))
