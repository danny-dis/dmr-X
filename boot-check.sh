#!/usr/bin/env bash
cd "$(dirname "$0")"
LOG=/tmp/gw_boot.log
rm -f "$LOG"
bun apps/gateway/src/main.ts > "$LOG" 2>&1 &
GW_PID=$!
echo "gw pid=$GW_PID"
UP=""
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 2 http://localhost:3000/health 2>/dev/null)
  if [ "$code" = "200" ]; then UP="yes after $((i*2))s"; break; fi
  # bail if process died
  if ! kill -0 "$GW_PID" 2>/dev/null; then echo "PROCESS DIED at ~$((i*2))s (last route before death below)"; break; fi
  sleep 2
done
echo "HEALTH_UP=$UP"
echo "LAST_ROUTE=$(grep -oE 'Registering route: [a-zA-Z]+' "$LOG" | tail -1)"
echo "LISTEN=$(grep -iE 'DMR-X Gateway running|All routes registered' "$LOG" | tail -1)"
echo "DB_ERRORS=$(grep -icE 'Failed to save database' "$LOG")"
echo "FATAL=$(grep -icE 'fatal|Uncaught|Unhandled' "$LOG")"
echo "=== health body ==="
curl -s -m 4 http://localhost:3000/health
echo ""
echo "=== tail 15 ==="
tail -15 "$LOG"
echo "=== process alive at end? ==="
kill -0 "$GW_PID" 2>/dev/null && echo ALIVE || echo DEAD
