#!/bin/bash
# DMR-X Stress Test
GATEWAY="http://127.0.0.1:47113"
TOTAL=30
CONCURRENT=5

echo "=== DMR-X Stress Test ==="
echo "Target: $GATEWAY"
echo ""

# ── 1. Baseline ──────────────────────────────────────────────────────────────
echo "--- 1. Baseline ---"
HEALTH_TIME=$(curl -s -o /dev/null -w "%{time_total}" "$GATEWAY/health")
echo "Health: ${HEALTH_TIME}s"

MODELS_COLD=$(curl -s -o /dev/null -w "%{time_total}" "$GATEWAY/v1/models")
MODELS_WARM=$(curl -s -o /dev/null -w "%{time_total}" "$GATEWAY/v1/models")
echo "Models (cold): ${MODELS_COLD}s"
echo "Models (warm): ${MODELS_WARM}s"
echo ""

# ── 2. Sequential requests ──────────────────────────────────────────────────
echo "--- 2. Sequential requests (gemini-2.5-flash) ---"
SEQ_FILE=$(mktemp)
for i in $(seq 1 10); do
  START=$(date +%s%N)
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"test"}],"max_tokens":10}')
  END=$(date +%s%N)
  ELAPSED=$(( (END - START) / 1000000 ))
  echo "$CODE $ELAPSED" >> "$SEQ_FILE"
done
echo "Status  Latency(ms)"
cat "$SEQ_FILE"
echo ""

# ── 3. Concurrent requests ──────────────────────────────────────────────────
echo "--- 3. Concurrent requests (auto model, 5 concurrent) ---"
CONC_FILE=$(mktemp)
for batch in $(seq 1 6); do
  for c in $(seq 1 $CONCURRENT); do
    (
      START=$(date +%s%N)
      CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GATEWAY/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d '{"model":"auto","messages":[{"role":"user","content":"test"}],"max_tokens":10}')
      END=$(date +%s%N)
      ELAPSED=$(( (END - START) / 1000000 ))
      echo "$CODE $ELAPSED" >> "$CONC_FILE"
    ) &
  done
  wait
  echo "Batch $batch done"
done
echo "Concurrent results:"
cat "$CONC_FILE"
echo ""

# ── 4. Route decisions ──────────────────────────────────────────────────────
echo "--- 4. Route decisions (hot path) ---"
ROUTE_FILE=$(mktemp)
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{time_total}\n" -X POST "$GATEWAY/v1/route" \
    -H "Content-Type: application/json" \
    -d '{"model":"auto","messages":[{"role":"user","content":"test"}]}' >> "$ROUTE_FILE" &
done
wait
echo "Route latency (ms):"
sort -n "$ROUTE_FILE" | head -20
echo ""

# ── 5. Stats ────────────────────────────────────────────────────────────────
echo "--- 5. Statistics ---"
for f in "$SEQ_FILE" "$CONC_FILE" "$ROUTE_FILE"; do
  if [ -f "$f" ] && [ -s "$f" ]; then
    echo "$(basename $f):"
    awk '{
      sum += $2; sumsq += $2*$2; n++
      vals[n] = $2
    } END {
      if (n > 0) {
        mean = sum / n
        variance = (sumsq - sum*sum/n) / n
        stddev = sqrt(variance > 0 ? variance : 0)
        asort(vals)
        p50 = vals[int(n*0.5)]
        p95 = vals[int(n*0.95)]
        p99 = vals[int(n*0.99)]
        printf "  n=%d mean=%.0fms stddev=%.0fms p50=%dms p95=%dms p99=%dms\n", n, mean, stddev, p50, p95, p99
      }
    }' "$f"
  fi
done

# ── 6. Error rate ──────────────────────────────────────────────────────────
echo ""
echo "--- 6. Error Rate ---"
if [ -f "$CONC_FILE" ]; then
  TOTAL=$(wc -l < "$CONC_FILE")
  ERRORS=$(grep -c "^5" "$CONC_FILE" || echo 0)
  ERRORS2=$(grep -c "^0" "$CONC_FILE" || echo 0)
  SUCCESS=$(( TOTAL - ERRORS - ERRORS2 ))
  echo "Total: $TOTAL"
  echo "HTTP 5xx: $ERRORS"
  echo "Connection failures: $ERRORS2"
  echo "Success: $SUCCESS / $TOTAL"
fi

rm -f "$SEQ_FILE" "$CONC_FILE" "$ROUTE_FILE"
echo ""
echo "=== Stress test complete ==="
