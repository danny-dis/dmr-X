"""Bounded read-only gates using explicit Node22; never install or clean."""
import json
import subprocess
import time
from pathlib import Path
import psutil

ROOT = Path(__file__).resolve().parents[1]
NODE = 'C:/Users/pc/AppData/Local/hermes/node/node.exe'
checks = [
    ('lint', [NODE, '--max-old-space-size=768', str(ROOT / 'node_modules/eslint/bin/eslint.js'), '.']),
    ('gateway-typecheck', [NODE, '--max-old-space-size=768', str(ROOT / 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'apps/gateway/tsconfig.json']),
    ('ui-typecheck', [NODE, '--max-old-space-size=768', str(ROOT / 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'apps/ui/tsconfig.app.json']),
]
records = []
for name, argv in checks:
    log = ROOT / 'reports' / ('readiness-headroom-' + name + '.log')
    started = time.time()
    with log.open('w', encoding='utf-8') as stream:
        child = subprocess.Popen(argv, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
        try:
            code = child.wait(timeout=90)
        except subprocess.TimeoutExpired:
            try:
                descendants = psutil.Process(child.pid).children(recursive=True)
            except psutil.NoSuchProcess:
                descendants = []
            for descendant in reversed(descendants):
                try:
                    descendant.kill()
                except psutil.NoSuchProcess:
                    pass
            child.kill()
            code = 124
    record = {'name': name, 'argv': argv, 'exit': code, 'duration_seconds': round(time.time() - started, 2), 'log': str(log)}
    records.append(record)
    (ROOT / 'reports/readiness-headroom-gates.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
    print(json.dumps(record), flush=True)
raise SystemExit(1 if any(item['exit'] != 0 for item in records) else 0)
