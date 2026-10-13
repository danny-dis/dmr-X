"""Non-destructive serial readiness probes; no install/cleanup/live writes."""
from pathlib import Path
import hashlib
import json
import subprocess
import time
import psutil

ROOT = Path(__file__).resolve().parents[1]
WORKERS = ROOT.parent / 'DMR-X-readiness-workers'
BUN = str(Path.home() / '.bun/bin/bun.exe')
OUT = ROOT / 'reports/readiness-resume-checks.json'
records = []
base = [BUN, 'vitest', 'run', '--config', 'vitest.config.ts', '--project', 'unit', '--maxWorkers', '1', '--reporter=json']
checks = [
    ('sharing-baseline', WORKERS / 'runtime', ['tests/unit/consumer-readiness-session-sharing.test.ts', 'tests/unit/consumer-readiness-sharing-lifecycle-review.test.ts'], 210),
    ('teams-current', WORKERS / 'teams', ['tests/unit/consumer-readiness-agent-teams.test.ts'], 150),
]
for name, cwd, tests, budget in checks:
    report = cwd / 'reports' / ('readiness-resume-' + name + '.json')
    report.parent.mkdir(exist_ok=True)
    log = ROOT / 'reports' / ('readiness-resume-' + name + '.log')
    argv = base + tests + ['--outputFile=' + str(report)]
    item = {'name': name, 'cwd': str(cwd), 'argv': argv, 'started': time.time(), 'memory_percent': psutil.virtual_memory().percent, 'log': str(log), 'report': str(report)}
    records.append(item)
    OUT.write_text(json.dumps(records, indent=2), encoding='utf-8')
    with log.open('w', encoding='utf-8') as stream:
        p = subprocess.Popen(argv, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT)
        item['pid'] = p.pid
        try:
            item['exit_code'] = p.wait(timeout=budget)
        except subprocess.TimeoutExpired:
            item['timed_out'] = True
            try:
                children = psutil.Process(p.pid).children(recursive=True)
            except psutil.NoSuchProcess:
                children = []
            for child in reversed(children):
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
            p.kill()
            p.wait()
            item['exit_code'] = 124
    item['duration_seconds'] = round(time.time() - item['started'], 1)
    if report.exists():
        data = json.loads(report.read_text(encoding='utf-8'))
        assertions = [a for t in data.get('testResults', []) for a in t.get('assertionResults', [])]
        item['declared_tests'] = data.get('numTotalTests')
        item['enumerated_tests'] = len(assertions)
        item['passed'] = sum(a['status'] == 'passed' for a in assertions)
        item['failed'] = sum(a['status'] == 'failed' for a in assertions)
        item['count_matches'] = item['declared_tests'] == len(assertions)
        item['failure_names'] = [a['fullName'] for a in assertions if a['status'] == 'failed']
        item['report_sha256'] = hashlib.sha256(report.read_bytes()).hexdigest()
    OUT.write_text(json.dumps(records, indent=2), encoding='utf-8')
    print(json.dumps(item), flush=True)
