"""
Needle Router — a local, OpenAI-compatible tool-calling HTTP service.

Wraps the Needle 26M-param tool-calling model (cactus-compute/needle) and exposes
an OpenAI chat/completions-shaped endpoint so DMR-X can register it as a cheap
"which tool?" pre-router that runs BEFORE an expensive model.

Bind: 0.0.0.0:8011
Concurrency: 2 workers, async-safe model load, query cache, batch endpoint.
"""
import asyncio
import hashlib
import json
import logging
import time
from typing import Any, List, Optional

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("needle-router")

app = FastAPI(title="Needle Router", version="0.2.0")

# Lazily-loaded model state. The checkpoint auto-downloads from HF on first
# request; if it (or the `needle` package) is missing the server still boots.
_MODEL = None
_PARAMS = None
_TOKENIZER = None
_MODEL_LOADED = False
_MODEL_LOCK = asyncio.Lock()

# Simple TTL cache for identical (query, tools) pairs.
# Needle is deterministic for the same inputs; caching avoids recomputation
# when repeated requests hit the same tool catalog.
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_TTL_SECONDS = 60
_CACHE_MAX_ENTRIES = 256


def _cache_key(query: str, tools: List[dict]) -> str:
    try:
        payload = json.dumps({"q": query, "tools": tools}, sort_keys=True, default=str)
    except Exception:
        payload = json.dumps({"q": query, "tools": []}, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _cache_get(key: str) -> Any | None:
    entry = _CACHE.get(key)
    if not entry:
        return None
    ts, value = entry
    if time.time() - ts > _CACHE_TTL_SECONDS:
        _CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any) -> None:
    if len(_CACHE) >= _CACHE_MAX_ENTRIES:
        # Evict oldest entry
        oldest = min(_CACHE.items(), key=lambda kv: kv[1][0])[0]
        _CACHE.pop(oldest, None)
    _CACHE[key] = (time.time(), value)


async def _load_model() -> None:
    """Load the Needle checkpoint lazily. Never raises — logs a warning instead."""
    global _MODEL, _PARAMS, _TOKENIZER, _MODEL_LOADED
    if _MODEL_LOADED:
        return
    async with _MODEL_LOCK:
        if _MODEL_LOADED:
            return
        try:
            from needle import SimpleAttentionNetwork, load_checkpoint, get_tokenizer

            params, config = load_checkpoint("checkpoints/needle.pkl")
            model = SimpleAttentionNetwork(config)
            tokenizer = get_tokenizer()
            _PARAMS, _MODEL, _TOKENIZER = params, model, tokenizer
            logger.info("Needle checkpoint loaded.")
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Needle checkpoint/package not available yet (%s). "
                "Endpoints will return 503 until `needle` + weights are installed.",
                exc,
            )


def _openai_tools_to_needle(tools: List[dict]) -> str:
    """Convert OpenAI tools array -> Needle's tools JSON-string format."""
    needle_tools = []
    for t in tools or []:
        fn = t.get("function", {}) if isinstance(t, dict) else {}
        needle_tools.append(
            {
                "name": fn.get("name", ""),
                "description": fn.get("description", ""),
                "parameters": fn.get("parameters", {}),
            }
        )
    return json.dumps(needle_tools)


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    model = body.get("model", "needle")
    messages = body.get("messages", [])
    tools = body.get("tools", [])

    # Use the LAST user message as the query text.
    query = ""
    for m in reversed(messages):
        if isinstance(m, dict) and m.get("role") == "user":
            query = m.get("content", "")
            if isinstance(query, list):  # multi-part content
                query = " ".join(
                    part.get("text", "") for part in query if isinstance(part, dict)
                )
            break

    cache_key = _cache_key(query, tools)
    cached = _cache_get(cache_key)
    if cached is not None:
        logger.debug("Needle cache hit for %s", cache_key[:12])
        return JSONResponse(content=cached)

    await _load_model()
    if _MODEL is None:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": "Needle model not loaded (missing package or weights).",
                    "type": "service_unavailable",
                }
            },
        )

    needle_tools_str = _openai_tools_to_needle(tools)

    try:
        from needle import generate

        # `generate` is synchronous CPU inference that takes tens of seconds.
        # Calling it directly from this coroutine blocked the uvicorn event
        # loop for its whole duration, so concurrent requests serialised
        # behind it and even /health stopped answering. Off-loading to the
        # default thread pool keeps the loop responsive and lets the two
        # workers actually overlap work.
        raw = await asyncio.to_thread(
            generate,
            _MODEL,
            _PARAMS,
            _TOKENIZER,
            query=query,
            tools=needle_tools_str,
            stream=False,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Needle generate failed: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"error": {"message": str(exc), "type": "internal_error"}},
        )

    # Needle returns a JSON STRING like: [{"name":..., "arguments":{...}}]
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:  # noqa: BLE001
        parsed = []

    tool_calls = []
    for i, call in enumerate(parsed or []):
        if not isinstance(call, dict):
            continue
        name = call.get("name", "")
        arguments = call.get("arguments", {})
        tool_calls.append(
            {
                "id": f"call_needle_{i}",
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": json.dumps(arguments) if not isinstance(arguments, str) else arguments,
                },
            }
        )

    created = int(time.time())
    completion_id = f"chatcmpl-needle-{created}"

    response = {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": tool_calls,
                },
                "finish_reason": "tool_calls" if tool_calls else "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
    }

    _cache_set(cache_key, response)
    return JSONResponse(content=response)


@app.post("/v1/batch/chat/completions")
async def batch_chat_completions(request: Request):
    """Batch multiple tool-routing requests in one call.

    Body:
    {
      "items": [
        {"messages": [...], "tools": [...]},
        ...
      ]
    }

    Returns:
    {
      "results": [
        {"id": ..., "choices": [...]},
        ...
      ]
    }
    """
    body = await request.json()
    items = body.get("items") or []
    if not isinstance(items, list) or len(items) == 0:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "`items` must be a non-empty list.", "type": "invalid_request_error"}},
        )

    await _load_model()
    if _MODEL is None:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": "Needle model not loaded (missing package or weights).",
                    "type": "service_unavailable",
                }
            },
        )

    results = []
    for item in items[:64]:
        messages = (item or {}).get("messages", [])
        tools = (item or {}).get("tools", [])

        query = ""
        for m in reversed(messages):
            if isinstance(m, dict) and m.get("role") == "user":
                query = m.get("content", "")
                if isinstance(query, list):
                    query = " ".join(
                        part.get("text", "") for part in query if isinstance(part, dict)
                    )
                break

        cache_key = _cache_key(query, tools)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.debug("Needle batch cache hit for %s", cache_key[:12])
            results.append(cached)
            continue

        needle_tools_str = _openai_tools_to_needle(tools)
        try:
            from needle import generate

            # Off the event loop for the same reason as the single-shot
            # endpoint — a batch of N queries would otherwise pin the loop
            # for N x inference time.
            raw = await asyncio.to_thread(
                generate,
                _MODEL,
                _PARAMS,
                _TOKENIZER,
                query=query,
                tools=needle_tools_str,
                stream=False,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Needle batch generate failed: %s", exc)
            results.append(
                {
                    "id": f"chatcmpl-needle-{int(time.time())}",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": "needle",
                    "choices": [],
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                    "error": {"message": str(exc), "type": "internal_error"},
                }
            )
            continue

        try:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:  # noqa: BLE001
            parsed = []

        tool_calls = []
        for i, call in enumerate(parsed or []):
            if not isinstance(call, dict):
                continue
            name = call.get("name", "")
            arguments = call.get("arguments", {})
            tool_calls.append(
                {
                    "id": f"call_needle_{i}",
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": json.dumps(arguments) if not isinstance(arguments, str) else arguments,
                    },
                }
            )

        created = int(time.time())
        completion_id = f"chatcmpl-needle-{created}"
        response = {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": "needle",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": tool_calls,
                    },
                    "finish_reason": "tool_calls" if tool_calls else "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            },
        }
        _cache_set(cache_key, response)
        results.append(response)

    return JSONResponse(content={"results": results})


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _MODEL is not None}


if __name__ == "__main__":
    # "server:app" as an import string, not the app object: uvicorn can only fork
    # workers from something it can re-import in the child. Passing the object
    # made it log 'You must pass the application as an import string to enable
    # reload or workers' and exit without ever binding :8011, so this entry point
    # never actually served. The README's uvicorn command line is the same thing.
    uvicorn.run("server:app", host="0.0.0.0", port=8011, workers=2)
