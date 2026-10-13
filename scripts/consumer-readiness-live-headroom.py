"""Bounded real free-only probe. No configuration changes or fake outputs."""
import copy
import json
import os
from pathlib import Path
import urllib.request
os.environ.setdefault('DMRX_BASELINE_TIMEOUT', '60')
import run_live_baseline as baseline
opener = urllib.request.build_opener()
opener.addheaders = [('x-cost-filter', 'free')]
urllib.request.install_opener(opener)
task = next(t for t in baseline.TASKS if t['id'] == 'code_bug_fix')
path = Path('reports/consumer-readiness-live-headroom.json')
report = {'purpose': 'distinguish truncation from functional routing error', 'request_headers': {'x-cost-filter': 'free'}, 'expected_cases': 4, 'results': []}
for model, budget in [('auto-smart', 2048), ('gemini-3.5-flash', 512), ('gemini-3.5-flash', 2048), ('auto-coding', 2048)]:
    probe = copy.deepcopy(task)
    probe['payload']['max_tokens'] = budget
    row = baseline.run_task(model, probe)
    row['max_tokens'] = budget
    report['results'].append(row)
    report['summary'] = baseline.summarize(report['results'])
    path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({k: row.get(k) for k in ('meta_model', 'max_tokens', 'passed', 'http_status', 'finish_reason', 'served_model', 'check_detail', 'error')}), flush=True)
