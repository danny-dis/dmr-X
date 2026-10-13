"""Add the isolated named-team lane without changing any existing worktree."""
from pathlib import Path
import json
import subprocess
root = Path.cwd()
source = root.parent / 'DMR-X-readiness-workers' / 'runtime'
dest = root.parent / 'DMR-X-readiness-workers' / 'teams'
if dest.exists():
    raise SystemExit('Refusing existing teams directory')
manifest = json.loads((source / '.agent-briefs/baseline-manifest.json').read_text())
subprocess.run(['git','worktree','add','--no-checkout','-b','jack/consumer-readiness-teams-20261011',str(dest)], check=True)
for name in manifest:
    old = source / name
    if old.is_file():
        new = dest / name
        new.parent.mkdir(parents=True, exist_ok=True)
        new.write_bytes(old.read_bytes())
for nm in [root/'node_modules'] + [p for group in ('apps','services','packages') for p in (root/group).glob('*/node_modules')]:
    if nm.exists():
        new = dest / nm.relative_to(root)
        new.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['cmd.exe','/c','mklink','/J',str(new),str(nm)], check=True,capture_output=True)
(dest/'.agent-briefs').mkdir(exist_ok=True)
(dest/'.agent-briefs/baseline-manifest.json').write_text(json.dumps(manifest))
(dest/'reports').mkdir(exist_ok=True)
print(json.dumps({'worktree':str(dest),'baseline_files':len(manifest)},indent=2))
