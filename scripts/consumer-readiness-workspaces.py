"""Create isolated worker snapshots; never reset/stash the user's tree.

Copies tracked working files and untracked source/tests only, without credentials
or live data. Records hashes for conflict-safe integration. Owned worktrees are
left intact for review. Run from repository root.
"""
from pathlib import Path
import hashlib
import json
import subprocess

root = Path.cwd()
report = root / 'reports' / 'consumer-readiness-workspaces'
report.mkdir(parents=True, exist_ok=True)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=root).decode('utf-8').strip()

tracked = git('ls-files', '-z').split('\0')
untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0')
extra = [p for p in untracked if p.startswith(('tests/', 'apps/', 'services/', 'packages/')) and p.endswith(('.ts', '.tsx', '.json', '.css'))]
files = [p for p in tracked + extra if p and (root / p).is_file() and not any(part in ('node_modules', 'dist', '.dmr-x', '.env') for part in Path(p).parts) and not Path(p).name.startswith('.env') and not p.startswith('reports/')]
manifest = {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in files}
(report / 'baseline-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
(report / 'starting-working-tree.patch').write_bytes(subprocess.check_output(['git', 'diff', '--binary'], cwd=root))
workspaces = {}
for lane in ('runtime', 'gateway', 'ui'):
    dest = root.parent / 'DMR-X-readiness-workers' / lane
    if dest.exists():
        raise SystemExit(f'Refusing to overwrite existing worker directory: {dest}')
    subprocess.run(['git', 'worktree', 'add', '-b', f'jack/consumer-readiness-{lane}-20261011', str(dest)], cwd=root, check=True)
    for name in files:
        target = dest / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((root / name).read_bytes())
    # Windows junctions let source aliases point at the worker while reusing
    # installed dependencies. No package install, credential or data copy.
    dependency_dirs = [root / 'node_modules'] + [p for group in ('apps', 'services', 'packages') for p in (root / group).glob('*/node_modules')]
    for nm in dependency_dirs:
        if not nm.exists():
            continue
        relative = nm.relative_to(root)
        if 'node_modules' in relative.parts[:-1] or any(x in relative.parts for x in ('reports', '.git', '.worktrees')):
            continue
        link = dest / relative
        if link.exists():
            continue
        link.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['cmd.exe', '/c', 'mklink', '/J', str(link), str(nm)], check=True, capture_output=True)
    (dest / 'reports').mkdir(exist_ok=True)
    (dest / '.agent-briefs').mkdir(exist_ok=True)
    (dest / '.agent-briefs' / 'baseline-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    workspaces[lane] = str(dest)
(report / 'workspaces.json').write_text(json.dumps(workspaces, indent=2), encoding='utf-8')
print(json.dumps({'workspaces': workspaces, 'snapshot_files': len(files), 'untracked_source_tests': len(extra)}, indent=2))
