"""Fresh Bun listeners; no provider credentials, daily DB, or inference calls."""
import json, os, shutil, socket, subprocess, tempfile, time, urllib.request, urllib.error
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports/production-2026-09-28-isolated-http.json'

def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def request(base, path, method='GET', headers=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
        headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status, r.read(1000000).decode(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(1000000).decode(), dict(e.headers)

results = []
for transport in ['http', 'sse']:
    directory = Path(tempfile.mkdtemp(prefix='dmrx-production-http-'))
    port = free_port()
    config = directory / 'mcp.json'
    config.write_text(json.dumps({'aggregation': {'enabled': False, 'servers': []},
        'externalServers': [], 'toolSearch': {'enableSemantic': False},
        'telemetry': {'enableTracing': False, 'enableMetrics': False},
        'a2a': {'enabled': True}}))
    safe_names = {'path','systemroot','windir','temp','tmp','localappdata','appdata','userprofile','home','comspec','pathext','systemdrive'}
    env = {k:v for k,v in os.environ.items() if k.lower() in safe_names}
    env.update({'NODE_ENV':'test', 'DMRX_MCP_CONFIG':str(config),
        'DMRX_MCP_TRANSPORT':transport, 'DMRX_MCP_HOST':'127.0.0.1', 'DMRX_MCP_PORT':str(port),
        'DMRX_DATA_DIR':str(directory/'data'), 'DMRX_MCP_WORKSPACE_ROOT':str(directory),
        'DMRX_MCP_API_KEY':'fixture-main', 'DMRX_MCP_AGENT_API_KEY':'fixture-downstream',
        'DMRX_MCP_API_KEYS_CONFIG':json.dumps([{'key':'fixture-restricted','allowedTools':['dmrx_status']}]),
        'DMRX_GATEWAY_URL':'http://127.0.0.1:9', 'DMRX_MCP_CORS_ORIGIN':'https://company.example',
        'DMRX_MCP_METRICS_PORT':str(free_port()), 'DMRX_OTEL_METRICS':'false', 'DMRX_OTEL_TRACING':'false',
        'DMRX_A2A_ENABLED':'true'})
    log_path = directory/'listener.log'
    checks = []
    with log_path.open('w') as log:
        proc = subprocess.Popen([shutil.which('bun'), '--no-env-file', str(ROOT/'services/mcp-server/src/index.ts')], cwd=directory, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            base=f'http://127.0.0.1:{port}'
            deadline=time.monotonic()+110
            while True:
                try:
                    if request(base,'/health')[0]==200: break
                except (OSError, TimeoutError): pass
                if proc.poll() is not None or time.monotonic()>deadline:
                    raise RuntimeError(f'listener unavailable; exit={proc.poll()}; log={log_path}')
                time.sleep(.25)
            def check(name, expected, path, method='GET', headers=None, body=None):
                status,text,_=request(base,path,method,headers,body)
                checks.append({'name':name,'expected':expected,'status':status,'passed':status==expected,'body':text[:250]})
            check('public discovery',200,'/.well-known/agent-card.json')
            check('A2A no key',401,'/a2a','POST',body={'jsonrpc':'2.0','id':1,'method':'tasks/list','params':{}})
            check('A2A bogus key',401,'/a2a','POST',{'Authorization':'Bearer bogus'}, {'jsonrpc':'2.0','id':1,'method':'tasks/list','params':{}})
            check('A2A restricted key',403,'/a2a','POST',{'Authorization':'Bearer fixture-restricted'}, {'jsonrpc':'2.0','id':1,'method':'tasks/list','params':{}})
            check('A2A valid key',200,'/a2a','POST',{'Authorization':'Bearer fixture-main'}, {'jsonrpc':'2.0','id':1,'method':'tasks/list','params':{}})
            check('reject hostile Origin',403,'/mcp','POST',{'Origin':'https://evil.invalid','Authorization':'Bearer fixture-main'}, {})
            check('reject hostile preflight',403,'/mcp','OPTIONS',{'Origin':'https://evil.invalid'})
            check('allowed preflight',204,'/mcp','OPTIONS',{'Origin':'https://company.example'})
            check('MCP no key',401,'/mcp' if transport=='http' else '/sse', 'POST' if transport=='http' else 'GET')
            results.append({'transport':transport,'checks':checks,'passed':all(c['passed'] for c in checks),'log':str(log_path)})
        except Exception as e:
            results.append({'transport':transport,'checks':checks,'passed':False,'error':str(e),'log':str(log_path)})
        finally:
            proc.terminate()
            try: proc.wait(timeout=10)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=10)
    REPORT.write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
