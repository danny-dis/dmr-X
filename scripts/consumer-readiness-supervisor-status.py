"""Cheap pre-run context for the DMR-X supervisor; no secrets/source mutations."""
from pathlib import Path
import json
import psutil
ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'reports'
def read_json(path):
    try: return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError): return None
queue = read_json(REPORTS / 'consumer-readiness-luna-queue.json') or {}
summary = {'verdict':'HOLD', 'queue_status':queue.get('status'), 'active_lane':queue.get('active_lane'), 'runner_alive':psutil.pid_exists(queue.get('runner_pid',0)), 'worker_alive':psutil.pid_exists(queue.get('active_pid',0)), 'lanes':queue.get('lanes',[])}
log = queue.get('active_log')
if log:
    try: summary['active_log_bytes'] = Path(log).stat().st_size
    except OSError: summary['active_log_bytes'] = None
summary['independent_reports'] = {}
for name in ('consumer-readiness-integrated-regressions.json','consumer-readiness-bun-source-check.json','consumer-readiness-native-host-policy.json','consumer-readiness-test-runtime.json'):
    d = read_json(REPORTS / name)
    if not d: continue
    row = {k:d.get(k) for k in ('numPassedTests','numFailedTests','numTotalTests','success') if k in d}
    if 'testResults' in d:
        row['enumerated_count_matches'] = sum(len(r.get('assertionResults',[])) for r in d['testResults']) == d.get('numTotalTests')
    if 'execPath' in d: row = d
    summary['independent_reports'][name] = row
summary['worker_receipts_unverified'] = {}
for lane in ('runtime','teams','ui','gateway'):
    path=ROOT.parent/'DMR-X-readiness-workers'/lane/'reports'/f'consumer-readiness-{lane}-completion.json'
    d=read_json(path)
    if d: summary['worker_receipts_unverified'][lane] = {'status':d.get('status'),'path':str(path)}
print(json.dumps(summary,indent=2))
