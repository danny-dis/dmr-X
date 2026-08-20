import json, time, urllib.request

NEEDLE = 'http://127.0.0.1:8011'
GW = 'http://127.0.0.1:47113'

TOOLS = [
    {'type': 'function', 'function': {'name': 'get_weather', 'description': 'Get current weather for a city.', 'parameters': {'type': 'object', 'properties': {'city': {'type': 'string'}}, 'required': ['city']}}},
    {'type': 'function', 'function': {'name': 'search_web', 'description': 'Search the web.', 'parameters': {'type': 'object', 'properties': {'query': {'type': 'string'}}, 'required': ['query']}}},
    {'type': 'function', 'function': {'name': 'calculate', 'description': 'Evaluate a math expression.', 'parameters': {'type': 'object', 'properties': {'expr': {'type': 'string'}}, 'required': ['expr']}}},
    {'type': 'function', 'function': {'name': 'get_stock_price', 'description': 'Get current stock ticker price.', 'parameters': {'type': 'object', 'properties': {'ticker': {'type': 'string'}}, 'required': ['ticker']}}},
    {'type': 'function', 'function': {'name': 'translate_text', 'description': 'Translate text to another language.', 'parameters': {'type': 'object', 'properties': {'text': {'type': 'string'}, 'lang': {'type': 'string'}}, 'required': ['text', 'lang']}}},
    {'type': 'function', 'function': {'name': 'get_news', 'description': 'Get latest news headlines.', 'parameters': {'type': 'object', 'properties': {'topic': {'type': 'string'}}, 'required': ['topic']}}},
    {'type': 'function', 'function': {'name': 'create_calendar_event', 'description': 'Add an event to calendar.', 'parameters': {'type': 'object', 'properties': {'title': {'type': 'string'}, 'date': {'type': 'string'}}, 'required': ['title', 'date']}}},
    {'type': 'function', 'function': {'name': 'send_email', 'description': 'Send an email.', 'parameters': {'type': 'object', 'properties': {'to': {'type': 'string'}, 'subject': {'type': 'string'}, 'body': {'type': 'string'}}, 'required': ['to', 'subject']}}},
    {'type': 'function', 'function': {'name': 'get_forex_rate', 'description': 'Get currency exchange rate.', 'parameters': {'type': 'object', 'properties': {'from': {'type': 'string'}, 'to': {'type': 'string'}}, 'required': ['from', 'to']}}},
    {'type': 'function', 'function': {'name': 'lookup_definition', 'description': 'Look up a word definition.', 'parameters': {'type': 'object', 'properties': {'word': {'type': 'string'}}, 'required': ['word']}}},
    {'type': 'function', 'function': {'name': 'convert_units', 'description': 'Convert between measurement units.', 'parameters': {'type': 'object', 'properties': {'value': {'type': 'number'}, 'from': {'type': 'string'}, 'to': {'type': 'string'}}, 'required': ['value', 'from', 'to']}}},
    {'type': 'function', 'function': {'name': 'geocode_address', 'description': 'Convert address to lat/long coordinates.', 'parameters': {'type': 'object', 'properties': {'address': {'type': 'string'}}, 'required': ['address']}}},
]

QUERY = 'What is the weather in San Francisco right now?'

def post(path, body, base=GW, timeout=180, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                base + path,
                data=json.dumps(body).encode(),
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise

def run_direct(n=5, label='Direct Needle 2'):
    times = []
    for i in range(n):
        body = {
            'model': 'needle2',
            'messages': [{'role': 'user', 'content': QUERY}],
            'tools': TOOLS,
        }
        t0 = time.perf_counter()
        try:
            resp = post('/v1/chat/completions', body, base=NEEDLE, timeout=180)
            elapsed = time.perf_counter() - t0
            calls = resp.get('choices', [{}])[0].get('message', {}).get('tool_calls', [])
            names = [tc.get('function', {}).get('name') for tc in calls]
            times.append(elapsed)
            print(f'  {label} #{i+1}: {elapsed:>6.2f}s  tools={names}')
        except Exception as e:
            elapsed = time.perf_counter() - t0
            print(f'  {label} #{i+1}: {elapsed:>6.2f}s  ERROR: {str(e)[:60]}')
            times.append(elapsed)
    return times

def run_agentic(enabled, n=5, label='Agentic'):
    put_body = json.dumps({'needleRouterEnabled': enabled}).encode()
    req = urllib.request.Request(
        GW + '/v1/admin/settings',
        data=put_body,
        headers={'Content-Type': 'application/json'},
        method='PUT',
    )
    urllib.request.urlopen(req, timeout=10).read()
    time.sleep(0.5)

    times = []
    for i in range(n):
        body = {
            'model': 'auto',
            'messages': [{'role': 'user', 'content': QUERY}],
            'max_steps': 1,
            'max_tokens': 150,
            'stream': False,
            'tools': TOOLS,
        }
        t0 = time.perf_counter()
        try:
            resp = post('/v1/agentic/chat', body, timeout=180)
            elapsed = time.perf_counter() - t0
            steps = resp.get('steps_completed', 0)
            all_steps = resp.get('all_steps', [])
            tool_calls = []
            for step in all_steps:
                for tc in (step.get('tool_calls') or []):
                    if isinstance(tc, dict):
                        name = tc.get('function', {}).get('name')
                        if name:
                            tool_calls.append(name)
            times.append(elapsed)
            print(f'  {label} #{i+1}: {elapsed:>6.2f}s  steps={steps}  called={tool_calls}')
        except Exception as e:
            elapsed = time.perf_counter() - t0
            print(f'  {label} #{i+1}: {elapsed:>6.2f}s  ERROR: {str(e)[:60]}')
            times.append(elapsed)
    return times

print('=' * 70)
print('WARM NEEDLE 2 BENCHMARK (service already initialized)')
print('=' * 70)

n = 3

print(f'\n--- A) Direct Needle 2 (:8011) [{n} runs] ---')
direct = run_direct(n)

print(f'\n--- B) Agentic, 12 tools, needle OFF [{n} runs] ---')
off = run_agentic(False, n)

print(f'\n--- C) Agentic, 12 tools, needle ON [{n} runs] ---')
on = run_agentic(True, n)

print('\n' + '=' * 70)
print('SUMMARY (warm)')
print('=' * 70)

def avg(lst):
    valid = [x for x in lst if x < 120]
    return sum(valid) / len(valid) if valid else float('inf')

print(f'  A) Direct Needle 2:      avg={avg(direct):.2f}s  (min={min(direct):.2f}s, max={max(direct):.2f}s)')
print(f'  B) Agentic needle OFF:   avg={avg(off):.2f}s  (min={min(off):.2f}s, max={max(off):.2f}s)')
print(f'  C) Agentic needle ON:    avg={avg(on):.2f}s  (min={min(on):.2f}s, max={max(on):.2f}s)')

if avg(on) < avg(off):
    ratio = avg(off)/avg(on)
    print(f'\n  Needle ON is {ratio:.1f}x FASTER than OFF')
    print(f'  Savings per request: {avg(off) - avg(on):.2f}s')
else:
    ratio = avg(on)/avg(off)
    print(f'\n  Needle ON is {ratio:.1f}x slower than OFF')
    print(f'  Tax per request: {avg(on) - avg(off):.2f}s')
