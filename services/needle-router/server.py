"""
Needle 2 Router — a local, OpenAI-compatible tool-calling HTTP service.

Wraps Needle 2 (cactus-needle), a 45M-param CQ2-bit tool-calling model with a
C inference engine. Exposes an OpenAI chat/completions-shaped endpoint so DMR-X
can register it as a cheap "which tool?" pre-router that runs BEFORE an
expensive model.

Bind: 0.0.0.0:8011
Concurrency: 2 workers, query cache, batch endpoint.
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

app = FastAPI(title="Needle 2 Router", version="0.3.0")

# Lazily-loaded package. The cactus-needle engine fetches once from Hugging Face
# and caches; if it (or the package) is missing the server still boots.
_PACKAGE = None
_PACKAGE_LOCK = asyncio.Lock()

# Simple TTL cache for identical (query, tools) pairs.
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
        oldest = min(_CACHE.items(), key=lambda kv: kv[1][0])[0]
        _CACHE.pop(oldest, None)
    _CACHE[key] = (time.time(), value)


async def _ensure_package() -> None:
    global _PACKAGE
    if _PACKAGE is not None:
        return
    async with _PACKAGE_LOCK:
        if _PACKAGE is not None:
            return
        try:
            import needle

            _PACKAGE = needle
            logger.info("cactus-needle %s loaded.", needle.__version__)
        except ImportError as exc:
            logger.warning(
                "cactus-needle not installed (%s). Endpoints will return 503.",
                exc,
            )


def _openai_tools_to_needle(tools: List[dict]) -> list:
    """Convert OpenAI tools array -> Needle 2 tool dicts."""
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
    return needle_tools


def _extract_tool_calls(response_data: dict) -> list:
    """Extract OpenAI-shaped tool_calls from a Needle 2 complete() response."""
    tool_calls = []
    for i, call in enumerate(response_data.get("function_calls") or []):
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
                    "arguments": json.dumps(arguments)
                    if not isinstance(arguments, str)
                    else arguments,
                },
            }
        )
    return tool_calls


def _extract_query(messages: list) -> str:
    """Use the LAST user message as the query text."""
    query = ""
    for m in reversed(messages):
        if isinstance(m, dict) and m.get("role") == "user":
            query = m.get("content", "")
            if isinstance(query, list):
                query = " ".join(
                    part.get("text", "") for part in query if isinstance(part, dict)
                )
            break
    return query


def _build_response(tool_calls: list, created: int) -> dict:
    return {
        "id": f"chatcmpl-needle-{created}",
        "object": "chat.completion",
        "created": created,
        "model": "needle2",
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


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    tools = body.get("tools", [])
    query = _extract_query(messages)

    cache_key = _cache_key(query, tools)
    cached = _cache_get(cache_key)
    if cached is not None:
        logger.debug("Needle cache hit for %s", cache_key[:12])
        return JSONResponse(content=cached)

    await _ensure_package()
    if _PACKAGE is None:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": "cactus-needle not installed.",
                    "type": "service_unavailable",
                }
            },
        )

    needle_tools = _openai_tools_to_needle(tools)

    try:
        # Needle 2's complete() is synchronous C inference; offload to thread pool
        # so it doesn't block the uvicorn event loop.
        def _infer():
            agent = _PACKAGE.Needle(tools=needle_tools)
            return agent.complete(query, max_new_tokens=64)

        response_data = await asyncio.to_thread(_infer)
    except Exception as exc:
        logger.error("Needle 2 complete failed: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"error": {"message": str(exc), "type": "internal_error"}},
        )

    tool_calls = _extract_tool_calls(response_data)
    created = int(time.time())
    response = _build_response(tool_calls, created)

    _cache_set(cache_key, response)
    return JSONResponse(content=response)


@app.post("/v1/batch/chat/completions")
async def batch_chat_completions(request: Request):
    """Batch multiple tool-routing requests in one call."""
    body = await request.json()
    items = body.get("items") or []
    if not isinstance(items, list) or len(items) == 0:
        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "message": "`items` must be a non-empty list.",
                    "type": "invalid_request_error",
                }
            },
        )

    await _ensure_package()
    if _PACKAGE is None:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": "cactus-needle not installed.",
                    "type": "service_unavailable",
                }
            },
        )

    results = []
    for item in items[:64]:
        messages = (item or {}).get("messages", [])
        tools = (item or {}).get("tools", [])
        query = _extract_query(messages)

        cache_key = _cache_key(query, tools)
        cached = _cache_get(cache_key)
        if cached is not None:
            results.append(cached)
            continue

        needle_tools = _openai_tools_to_needle(tools)
        try:

            def _infer():
                agent = _PACKAGE.Needle(tools=needle_tools)
                return agent.complete(query, max_new_tokens=64)

            response_data = await asyncio.to_thread(_infer)
        except Exception as exc:
            logger.error("Needle 2 batch complete failed: %s", exc)
            results.append(
                {
                    "id": f"chatcmpl-needle-{int(time.time())}",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": "needle2",
                    "choices": [],
                    "usage": {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                    },
                    "error": {"message": str(exc), "type": "internal_error"},
                }
            )
            continue

        tool_calls = _extract_tool_calls(response_data)
        created = int(time.time())
        response = _build_response(tool_calls, created)
        _cache_set(cache_key, response)
        results.append(response)

    return JSONResponse(content={"results": results})


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "package_loaded": _PACKAGE is not None,
        "model": "needle2",
    }


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8011, workers=2)
