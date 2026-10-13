"""Readiness verification only; no source cleanup, service restart or publish."""
from pathlib import Path
import json
import os
import subprocess
import time
import psutil

ROOT = Path(__file__).resolve().parents[1]
WORKERS = ROOT.parent / 'DMR-X-readiness-workers'
BUN = str(Path.home() / '.bun/bin/bun.exe')
NODE = str(Path.home() / 'bin/node.exe')
TSC = str(ROOT / 'node_modules/typescript/bin/tsc')
REPORT = ROOT / 'reports/consumer-readiness-final-checks.json'
RESULTS = []


def run(name, cwd, argv, budget=180):
    log = ROOT / 'reports' / f'consumer-readiness-final-{name}.log'
    item = {'name': name, 'cwd': str(cwd), 'argv': argv, 'log': str(log), 'started': time.time()}
    RESULTS.append(item)
    REPORT.write_text(json.dumps(RESULTS, indent=2), encoding='utf-8')
    with log.open('w', encoding='utf-8') as output:
        proc = subprocess.Popen(argv, cwd=str(cwd), stdout=output, stderr=subprocess.STDOUT)
        item['pid'] = proc.pid
        try:
            item['exit_code'] = proc.wait(timeout=budget)
        except subprocess.TimeoutExpired:
            item['status'] = 'timeout'
            try:
                children = psutil.Process(proc.pid).children(recursive=True)
            except psutil.NoSuchProcess:
                children = []
            for child in reversed(children):
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
            proc.kill()
            proc.wait()
            item['exit_code'] = 124
    item.setdefault('status', 'passed' if item['exit_code'] == 0 else 'failed')
    item['duration_seconds'] = round(time.time() - item['started'], 1)
    REPORT.write_text(json.dumps(RESULTS, indent=2), encoding='utf-8')
    print(json.dumps(item), flush=True)


if __name__ == '__main__':
    base = [BUN, 'vitest', 'run', '--config', 'vitest.config.ts', '--project', 'unit', '--maxWorkers', '1', '--reporter=json']
    run('focused', ROOT, base + ['tests/unit/auto-json-transient-retry.test.ts', 'tests/unit/fallback-readiness-regression.test.ts', 'tests/unit/free-degraded-fallback.test.ts', 'tests/unit/quota-readiness-scope.test.ts', 'tests/unit/consumer-readiness-vitest-config.test.ts', 'tests/unit/consumer-readiness-runtime-identity.test.ts', '--outputFile=reports/consumer-readiness-final-focused.json'])
    run('sharing', WORKERS / 'runtime', base + ['tests/unit/consumer-readiness-session-sharing.test.ts', 'tests/unit/consumer-readiness-sharing-lifecycle-review.test.ts', '--outputFile=reports/consumer-readiness-final-sharing.json'])
    run('teams', WORKERS / 'teams', base + ['tests/unit/consumer-readiness-agent-teams.test.ts', '--outputFile=reports/consumer-readiness-final-teams.json'])
    run('gateway-typecheck', ROOT, [NODE, '--max-old-space-size=768', TSC, '--noEmit', '-p', 'apps/gateway/tsconfig.json'])
    run('ui-typecheck', ROOT, [NODE, '--max-old-space-size=768', TSC, '--noEmit', '-p', 'apps/ui/tsconfig.app.json'])
    run('runtime-typecheck', WORKERS / 'runtime', [NODE, '--max-old-space-size=768', TSC, '--noEmit', '-p', 'services/agent-runtime/tsconfig.json'])
    run('teams-typecheck', WORKERS / 'teams', [NODE, '--max-old-space-size=768', TSC, '--noEmit', '-p', 'services/agent-runtime/tsconfig.json'])
    run('catalog', ROOT, [BUN, 'run', 'mcp:catalog:check'])
    run('audit', ROOT, [BUN, 'audit', '--audit-level=high'])
