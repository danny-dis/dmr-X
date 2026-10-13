"""Read-only Chrome/CDP UI probe. Owns only its fresh headless profile/process."""
import base64
import json
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
import websocket

out = Path('reports/consumer-readiness-browser')
out.mkdir(parents=True, exist_ok=True)
sock = socket.socket()
sock.bind(('127.0.0.1', 0))
port = sock.getsockname()[1]
sock.close()
profile = tempfile.mkdtemp(prefix='dmrx-readiness-chrome-')
proc = subprocess.Popen([
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', f'--remote-debugging-port={port}',
    f'--user-data-dir={profile}', '--window-size=1440,900', 'about:blank',
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ws = None
report = {'browser': 'Chrome headless CDP', 'base_url': 'http://127.0.0.1:47113', 'profile': profile, 'pages': [], 'errors': []}
try:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            tabs = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list', timeout=3).read())
            target = next(t for t in tabs if t.get('type') == 'page')
            break
        except Exception:
            time.sleep(.4)
    else:
        raise RuntimeError('Owned Chrome CDP listener did not become ready')
    ws = websocket.create_connection(target['webSocketDebuggerUrl'], timeout=90, suppress_origin=True)
    seq = 0
    events = []
    def command(method, params=None):
        global seq
        seq += 1
        ident = seq
        ws.send(json.dumps({'id': ident, 'method': method, 'params': params or {}}))
        while True:
            row = json.loads(ws.recv())
            if row.get('id') == ident:
                if row.get('error'):
                    raise RuntimeError(f'{method}: {row["error"]}')
                return row.get('result', {})
            events.append(row)
    def evaluate(expression):
        row = command('Runtime.evaluate', {'expression': expression, 'returnByValue': True})
        if row.get('exceptionDetails'):
            raise RuntimeError(str(row['exceptionDetails']))
        return row['result'].get('value')
    command('Page.enable')
    command('Runtime.enable')
    command('Network.enable')
    for route in ('/runtime', '/agents/create', '/free-tier'):
        before = len(events)
        command('Page.navigate', {'url': report['base_url'] + route})
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            state = evaluate('({ready:document.readyState,text:document.body.innerText, title:document.title, path:location.pathname})')
            if state['ready'] == 'complete' and len(state['text']) > 200 and 'Loading page' not in state['text']:
                break
            time.sleep(.5)
        details = evaluate("({text:document.body.innerText,links:Array.from(document.querySelectorAll('a')).map(a=>({text:a.innerText,href:a.getAttribute('href')})),buttons:Array.from(document.querySelectorAll('button')).map(b=>({text:b.innerText,label:b.getAttribute('aria-label'),disabled:b.disabled})),inputs:Array.from(document.querySelectorAll('input,textarea')).map(e=>({id:e.id,type:e.type,label:document.querySelector('label[for=\\\"'+e.id+'\\\"]')?.innerText})),horizontalOverflow:document.documentElement.scrollWidth>innerWidth})")
        name = route.strip('/').replace('/', '-') or 'home'
        shot = command('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
        image = out / f'{name}-desktop.png'
        image.write_bytes(base64.b64decode(shot['data']))
        row = {'route': route, 'state': state, 'dom': details, 'screenshot': str(image.resolve()), 'exceptions': [e.get('params') for e in events[before:] if e.get('method') == 'Runtime.exceptionThrown']}
        command('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        row['mobile'] = evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth})')
        shot = command('Page.captureScreenshot', {'format': 'png'})
        mobile = out / f'{name}-mobile.png'
        mobile.write_bytes(base64.b64decode(shot['data']))
        row['mobile_screenshot'] = str(mobile.resolve())
        command('Emulation.clearDeviceMetricsOverride')
        report['pages'].append(row)
        (out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps({'route': route, 'title': state['title'], 'path': state['path'], 'mobile_overflow': row['mobile']['overflow'], 'exceptions': len(row['exceptions'])}), flush=True)
except Exception as error:
    report['errors'].append(f'{type(error).__name__}: {error}')
    raise
finally:
    (out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    if ws:
        ws.close()
    # Terminate only our profile-rooted Chrome process tree, never user Chrome.
    import psutil
    try:
        parent = psutil.Process(proc.pid)
        children = parent.children(recursive=True)
        for child in children:
            try: child.terminate()
            except psutil.Error: pass
        parent.terminate()
        psutil.wait_procs(children + [parent], timeout=10)
    except psutil.Error:
        pass
