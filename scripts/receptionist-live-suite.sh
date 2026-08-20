#!/usr/bin/env bash
# Live Receptionist test suite — varied job briefs simulating real usage.
# Submits every job, plans it, runs it, then polls until terminal state.
#
# Usage: bash scripts/receptionist-live-suite.sh
set -uo pipefail

GW="${DMRX_GATEWAY_URL:-http://localhost:47113}"
KEY="${DMRX_ADMIN_API_KEY:?set DMRX_ADMIN_API_KEY}"
OUT="${BH_AGENT_WORKSPACE:-/tmp}/receptionist-suite-$(date +%s).json"

# name|brief|budgetUsd
JOBS=(
  "code_simple|Write a Python function that reverses a string, with a docstring and one usage example.|0.02"
  "code_algo|Implement binary search in Python with edge-case handling for empty lists and duplicates. Include unit tests.|0.03"
  "research|Compare REST and GraphQL for a mobile backend. Give 3 concrete tradeoffs and a recommendation.|0.03"
  "debug|A Python function returns None instead of a list. Explain the 3 most likely root causes and how to confirm each.|0.02"
  "docs|Write a concise README section explaining how to configure an API key via environment variable.|0.02"
  "sql|Write a SQL query to find the top 5 customers by total order value, and explain the joins.|0.02"
  "review|Review this code for bugs: def div(a,b): return a/b — list every failure mode and the fix.|0.02"
  "multistep|Design a rate limiter: pick an algorithm, justify it, sketch the data structure, and note one failure mode.|0.04"
)

echo "[]" > "$OUT"
declare -a IDS NAMES

echo "=== PHASE 1: submit + plan ==="
for entry in "${JOBS[@]}"; do
  IFS='|' read -r name brief budget <<< "$entry"
  resp=$(curl -sS -X POST "$GW/v1/jobs" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d "$(python -c "
import json,sys
print(json.dumps({'brief':sys.argv[1],'source':'api','budgetUsd':float(sys.argv[2])}))
" "$brief" "$budget")")
  jid=$(python -c "import sys,json; print(json.load(sys.stdin).get('id',''))" <<< "$resp")
  if [ -z "$jid" ]; then echo "  ✗ $name: submit failed: $resp"; continue; fi

  plan=$(curl -sS -X POST "$GW/v1/jobs/$jid/plan" -H "Authorization: Bearer $KEY" --max-time 180)
  tc=$(python -c "import sys,json
try:
  d=json.load(sys.stdin); print(d.get('taskCount', 'ERR:'+str(d.get('error',{}).get('message',''))[:60]))
except Exception as e: print('ERR:parse')" <<< "$plan")
  echo "  → $name  job=${jid:0:8}  tasks=$tc"
  IDS+=("$jid"); NAMES+=("$name")
done

echo
echo "=== PHASE 2: run all ==="
for i in "${!IDS[@]}"; do
  r=$(curl -sS -X POST "$GW/v1/jobs/${IDS[$i]}/run" -H "Authorization: Bearer $KEY")
  st=$(python -c "import sys,json
try: print(json.load(sys.stdin).get('status','?'))
except: print('err')" <<< "$r")
  echo "  → ${NAMES[$i]}: $st"
done

echo
echo "=== PHASE 3: poll to terminal (max 25 min) ==="
TERMINAL="delivered failed cancelled blocked"
for round in $(seq 1 50); do
  sleep 30
  pending=0; line=""
  for i in "${!IDS[@]}"; do
    j=$(curl -sS "$GW/v1/jobs/${IDS[$i]}" -H "Authorization: Bearer $KEY")
    s=$(python -c "import sys,json
try: print(json.load(sys.stdin).get('status','?'))
except: print('?')" <<< "$j")
    line="$line ${NAMES[$i]}=$s"
    case " $TERMINAL " in *" $s "*) ;; *) pending=$((pending+1)) ;; esac
  done
  echo "[t+$((round*30))s]$line"
  [ "$pending" -eq 0 ] && { echo "All jobs terminal."; break; }
done

echo
echo "=== FINAL REPORT ==="
python - "$GW" "$KEY" "$OUT" "${IDS[@]}" <<'PY'
import json,sys,urllib.request
gw,key,out=sys.argv[1],sys.argv[2],sys.argv[3]
ids=sys.argv[4:]
def get(p):
    r=urllib.request.Request(gw+p,headers={'Authorization':'Bearer '+key})
    return json.load(urllib.request.urlopen(r,timeout=30))
rows=[]
for jid in ids:
    try:
        j=get('/v1/jobs/'+jid); ts=get('/v1/jobs/'+jid+'/tasks')
        done=sum(1 for t in ts if t['status']=='completed')
        rows.append({'id':jid,'status':j['status'],'brief':j['brief'][:55],
                     'tasks':len(ts),'completed':done,'tokens':j['spentTokens']})
    except Exception as e:
        rows.append({'id':jid,'status':'POLL_ERR','brief':str(e)[:40],'tasks':0,'completed':0,'tokens':0})
open(out,'w').write(json.dumps(rows,indent=2))
print(f"{'status':<11}{'tasks':>7}{'tokens':>9}  brief")
print('-'*82)
for r in rows:
    print(f"{r['status']:<11}{str(r['completed'])+'/'+str(r['tasks']):>7}{r['tokens']:>9}  {r['brief']}")
d=sum(1 for r in rows if r['status']=='delivered')
print('-'*82)
print(f"delivered {d}/{len(rows)} | total tokens {sum(r['tokens'] for r in rows):,}")
print(f"saved: {out}")
PY
