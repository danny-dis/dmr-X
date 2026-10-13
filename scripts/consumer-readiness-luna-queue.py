"""Durable serial Luna continuation. Does not integrate, commit, deploy or certify.

Each worker owns a dirty-snapshot worktree and a self-contained input brief.
The controller/supervisor must independently verify its receipts and source.
"""
from pathlib import Path
import datetime
import json
import os
import subprocess
import sys
import time
import psutil
ROOT = Path(__file__).resolve().parents[1]
WORKERS = ROOT.parent / 'DMR-X-readiness-workers'
STATE = ROOT / 'reports/consumer-readiness-luna-queue.json'
CLI_ROOT = Path('C:/Users/pc/AppData/Local/hermes/hermes-agent')
LANES = ['runtime', 'teams', 'ui', 'gateway']
state = {'model':'gpt-6-luna', 'provider':'openai-codex', 'runner_pid':os.getpid(), 'lanes':[], 'status':'starting'}
def persist():
    state['updated_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    tmp = STATE.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, indent=2), encoding='utf-8')
    os.replace(tmp, STATE)
    print(json.dumps({k:state[k] for k in ('status','updated_at')}) + ' ' + str(state.get('active_lane','')), flush=True)
persist()
for lane in LANES:
    worktree = WORKERS / lane
    brief = worktree / '.agent-briefs/continue-readiness.md'
    if not brief.exists():
        state['lanes'].append({'lane':lane,'status':'blocked','error':'missing input brief'})
        persist()
        continue
    state.update(status='resource_wait', active_lane=lane)
    persist()
    # Avoid piling a fresh inference/tool process onto a near-exhausted host.
    # Bounded wait only; record a blocker rather than claim a worker ran.
    ready = False
    for _ in range(15):
        state['memory_percent'] = psutil.virtual_memory().percent
        if state['memory_percent'] < 90:
            ready = True
            break
        persist()
        time.sleep(40)
    if not ready:
        state['lanes'].append({'lane':lane,'status':'blocked','error':'host memory remained >=90%'})
        persist()
        continue
    reports = worktree / 'reports'
    reports.mkdir(exist_ok=True)
    output = reports / f'consumer-readiness-{lane}-cli.log'
    env = dict(os.environ)
    env['PYTHONPATH'] = str(CLI_ROOT) + (os.pathsep + env['PYTHONPATH'] if env.get('PYTHONPATH') else '')
    command = [sys.executable, '-m', 'hermes_cli.main', 'chat', '--oneshot', '--query-file', str(brief), '--in', str(worktree), '--model', 'gpt-6-luna', '--provider', 'openai-codex', '--max-turns', '60', '--run-budget', '5400', '--source', 'dmrx-consumer-readiness']
    with output.open('w', encoding='utf-8') as log:
        process = subprocess.Popen(command, cwd=worktree, env=env, stdout=log, stderr=subprocess.STDOUT)
        state.update(status='running', active_pid=process.pid, active_log=str(output))
        persist()
        try:
            exit_code = process.wait(timeout=5700)
        except subprocess.TimeoutExpired:
            # Terminate only this runner's direct owned child tree.
            try:
                owned = psutil.Process(process.pid)
                for child in reversed(owned.children(recursive=True)):
                    try: child.kill()
                    except psutil.Error: pass
            except psutil.Error: pass
            process.kill()
            process.wait()
            exit_code = 124
    receipt = reports / f'consumer-readiness-{lane}-completion.json'
    row = {'lane':lane,'cli_exit_code':exit_code,'status':'awaiting_independent_review','log':str(output),'receipt':str(receipt),'receipt_exists':receipt.exists()}
    if exit_code != 0:
        row['status'] = 'blocked'
    state['lanes'].append(row)
    state.pop('active_pid',None)
    persist()
state.update(status='awaiting_independent_review', active_lane=None)
persist()
