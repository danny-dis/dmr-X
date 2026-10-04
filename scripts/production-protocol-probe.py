"""Read-only wire probes; never execute inference or arbitrary listed tools."""
import json
import urllib.error
import urllib.request
from pathlib import Path

BASE = 'http://127.0.0.1:47114'
rows = []


def request(label, path, payload=None, headers=None, method=None):
    h = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', **(headers or {})}
    req = urllib.request.Request(BASE + path, data=None if payload is None else json.dumps(payload).encode(), headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            status, rh, text = response.status, dict(response.headers), response.read().decode()
    except urllib.error.HTTPError as error:
        status, rh, text = error.code, dict(error.headers), error.read().decode()
    except Exception as error:
        rows.append({'label': label, 'transport_error': str(error)})
        return {}, {}
    try:
        events = [line[5:].strip() for line in text.splitlines() if line.startswith('data:')]
        body = json.loads(events[-1] if events else text) if text else {}
    except (ValueError, IndexError):
        body = {}
    result = body.get('result', {}) if isinstance(body, dict) else {}
    row = {'label': label, 'http_status': status, 'rpc_error': body.get('error') if isinstance(body, dict) else None,
           'result_keys': list(result) if isinstance(result, dict) else [], 'content_type': rh.get('content-type', rh.get('Content-Type'))}
    if isinstance(result, dict) and 'tools' in result:
        row['tool_count'] = len(result['tools'])
        row['readonly_candidates'] = [t['name'] for t in result['tools'] if t['name'] in ('dmrx_health', 'dmrx_list_models', 'dmrx_status')]
    if isinstance(result, dict) and 'tasks' in result:
        row['task_count'] = len(result['tasks'])
        row['nextPageToken_present'] = 'nextPageToken' in result
    rows.append(row)
    return body, rh


card, _ = request('agent-card', '/.well-known/agent-card.json')
rows[-1]['advertised_interfaces'] = card.get('supportedInterfaces')
rows[-1]['legacy_protocol'] = card.get('protocolVersion')
for method in ('ListTasks', 'tasks/list'):
    request(method, '/a2a', {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': {'pageSize': 1}}, {'A2A-Version': '1.0'})
meta = {'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': {'name': 'dmrx-production-audit', 'version': '1'}, 'io.modelcontextprotocol/clientCapabilities': {}}
request('MCP-2026-tools-list', '/mcp', {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {'_meta': meta}}, {'MCP-Protocol-Version': '2026-07-28'})
request('MCP-invalid-origin', '/mcp', {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/list', 'params': {'_meta': meta}}, {'MCP-Protocol-Version': '2026-07-28', 'Origin': 'https://untrusted.invalid'})
body, headers = request('MCP-legacy-initialize', '/mcp', {'jsonrpc': '2.0', 'id': 4, 'method': 'initialize', 'params': {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'dmrx-production-audit', 'version': '1'}}})
sid = next((v for k, v in headers.items() if k.lower() == 'mcp-session-id'), None)
if sid:
    h = {'Mcp-Session-Id': sid, 'MCP-Protocol-Version': body.get('result', {}).get('protocolVersion', '2025-03-26')}
    request('MCP-legacy-initialized', '/mcp', {'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}}, h)
    request('MCP-legacy-tools-list', '/mcp', {'jsonrpc': '2.0', 'id': 5, 'method': 'tools/list', 'params': {}}, h)
    request('MCP-close-own-session', '/mcp', headers=h, method='DELETE')
path = Path('reports/production-2026-09-28-protocol-live.json')
path.write_text(json.dumps(rows, indent=2) + '\n', encoding='utf-8')
print(json.dumps(rows, indent=2))
