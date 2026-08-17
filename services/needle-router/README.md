# Needle 2 Router

A local, OpenAI-compatible tool-calling HTTP service that wraps **Needle 2** (`cactus-needle`), a 45M-param CQ2-bit tool-calling model with a C inference engine. DMR-X registers it as a cheap first-stage "which tool?" pre-router that runs before an expensive model, narrowing a large tool list down to the few most relevant functions.

## Install

```bash
bash setup.sh
```

## Run

```bash
uvicorn server:app --host 0.0.0.0 --port 8011 --workers 2
```

## Usage

### Single request
```bash
curl -X POST http://localhost:8011/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "needle2",
    "messages": [{"role": "user", "content": "What is the weather in SF?"}],
    "tools": [
      {
        "function": {
          "name": "get_weather",
          "description": "Get current weather for a city.",
          "parameters": {"location": {"type": "string", "required": true}}
        }
      }
    ]
  }'
```

### Batch request
```bash
curl -X POST http://localhost:8011/v1/batch/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "messages": [{"role": "user", "content": "Weather in SF"}],
        "tools": [{"function": {"name": "get_weather", "description": "...", "parameters": {}}}]
      },
      {
        "messages": [{"role": "user", "content": "Create a calendar event"}],
        "tools": [{"function": {"name": "create_event", "description": "...", "parameters": {}}}]
      }
    ]
  }'
```

Response:
```json
{
  "results": [
    {"id": "chatcmpl-needle-...", "choices": [...]},
    {"id": "chatcmpl-needle-...", "choices": [...]}
  ]
}
```

## Notes
- Requires `cactus-needle>=2.0.0` (installed by `setup.sh`). The engine auto-downloads from Hugging Face on first use and caches under `~/.cache/cactus-needle/`. The server boots even if it is not yet present (it returns `503` until the package is installed).
- Needle 2's context limit is 256 tokens (sliding window), so keep queries and tool lists small.
- Server includes: 2-worker Uvicorn, async-safe lazy package loading, in-memory TTL cache, and batch endpoint for tool-routing fan-out.
- Cache key is a SHA-256 over query + tool schema, TTL 60s, max 256 entries.
