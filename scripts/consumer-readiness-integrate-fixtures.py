"""Conflict-safe integration of the four reviewed fallback fixture repairs only."""
from pathlib import Path
import hashlib
import json
import subprocess
import psutil
root = Path(__file__).resolve().parents[1]
worker = root.parent / 'DMR-X-readiness-workers/gateway'
report_dir = root / 'reports'
report_dir.mkdir(exist_ok=True)
node = 'C:/Users/pc/AppData/Local/hermes/node/node.exe'
cli = 'C:/Users/pc/AppData/Roaming/npm/node_modules/gitnexus/dist/cli/index.js'
impact = {'target': 'response', 'direction': 'upstream', 'scope': 'test fixture factory only'}
p = subprocess.Popen([node, cli, 'impact', 'response', '--repo', 'dmr-X', '--direction', 'upstream', '--summary-only'], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
try:
    output, _ = p.communicate(timeout=40)
    impact.update(exit_code=p.returncode, output=output)
except subprocess.TimeoutExpired:
    proc = psutil.Process(p.pid)
    for child in reversed(proc.children(recursive=True)):
        try: child.kill()
        except psutil.Error: pass
    p.kill()
    output, _ = p.communicate()
    impact.update(exit_code=124, output=output, limitation='graph impact unavailable; no production functions edited')
(report_dir / 'consumer-readiness-test-fixture-impact.json').write_text(json.dumps(impact, indent=2))
baseline = json.loads((worker / '.agent-briefs/baseline-manifest.json').read_text())
files = [
    'tests/unit/fallback-readiness-regression.test.ts',
    'tests/unit/free-degraded-fallback.test.ts',
    'tests/unit/quota-readiness-scope.test.ts',
    'tests/unit/auto-json-transient-retry.test.ts',
]
updates = []
for name in files:
    original = (root / name).read_bytes()
    updated = (worker / name).read_bytes()
    if hashlib.sha256(original).hexdigest() != baseline.get(name):
        raise SystemExit('CONFLICT: refusing to overwrite changed main file: ' + name)
    updates.append((name, original, updated))
receipt = []
for name, original, updated in updates:
    backup = root / '.agent-briefs/main-before-readiness-integration' / name
    backup.parent.mkdir(parents=True, exist_ok=True)
    backup.write_bytes(original)
    (root / name).write_bytes(updated)
    verified = (root / name).read_bytes() == updated
    receipt.append({'path': name, 'sha256': hashlib.sha256(updated).hexdigest(), 'verified': verified})
    if not verified: raise SystemExit('Readback mismatch: ' + name)
(report_dir / 'consumer-readiness-fixture-integration.json').write_text(json.dumps(receipt, indent=2))
print(json.dumps(receipt, indent=2), flush=True)
