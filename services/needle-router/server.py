"""
Needle 3 Router — a local, OpenAI-compatible tool-calling HTTP service.

Wraps Needle 3 (cactus-needle), a sliceable tool-calling model with a C
inference engine. Exposes an OpenAI chat/completions-shaped endpoint so DMR-X
can register it as a cheap "which tool?" pre-router that runs BEFORE an
expensive model.

Depth is the main latency lever on CPU-only hardware: set NEEDLE_WEIGHTS to a
shallower `needle build --layers N` export. See _WEIGHTS below.

Bind: 0.0.0.0:8011
Concurrency: 1 worker (each worker spawns its own engine subprocess, so more
than one just contends on a small CPU), query cache, batch endpoint.
"""
import asyncio
import hashlib
import json
import logging
import os
import re
import time
from typing import Any, List, Optional

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("needle-router")

app = FastAPI(title="Needle 3 Router", version="0.4.0")

# Lazily-loaded package. The cactus-needle engine fetches once from Hugging Face
# and caches; if it (or the package) is missing the server still boots.
_PACKAGE = None
_PACKAGE_LOCK = asyncio.Lock()
# True once a throwaway inference has completed, so the engine is resident and
# the next real request won't pay the ~14s cold-start.
_WARMED = False

# Optional path to a shallower "rung" of the Needle 3 depth ladder (e.g. a
# 4-layer export). Depth is the single biggest latency lever on CPU-only
# hardware. Measured on a 2011 Intel i5-2540M (no AVX2/FMA), 24-tool
# catalogue, stateless: full 20-layer = 18-43s per call, 8-layer = 7-12s,
# 4-layer = 1.8-3.8s. Set NEEDLE_WEIGHTS to the .cact you built with
# `needle build --layers N`.
# Directory holding this service, so rung paths resolve regardless of the
# process working directory (PM2, a shell, or a test harness).
_SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))


def _weights_path(weights: Optional[str]) -> Optional[str]:
    """Filesystem path for a rung name. `_WEIGHTS` itself stays a bare
    filename so /health and the admin API report something UI-friendly."""
    if not weights:
        return None
    return weights if os.path.isabs(weights) else os.path.join(_SERVICE_DIR, weights)


_WEIGHTS = os.environ.get("NEEDLE_WEIGHTS") or None

# Simple TTL cache for identical (query, tools) pairs.
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_TTL_SECONDS = 60
_CACHE_MAX_ENTRIES = 256

# Cache of constructed Needle agents, keyed by the tool-set hash.
#
# This is the single most important performance fix in this file. Building a
# `Needle(tools=...)` costs 7-48s on CPU-only hardware (engine + grammar
# compile), while an inference on an already-built agent costs 1.8-3.8s with
# the 4-layer rung. Constructing per request therefore dominated every call.
#
# Safe to share because the agent is built with `stateless=True`, so each
# complete() is an independent turn and no conversation accumulates.
_AGENTS: dict[str, Any] = {}
_AGENT_MAX_ENTRIES = 8


# Resolved once on first read: the cactus-needle package version.
_VERSION_CACHE: dict[str, Any] = {"package": None}


def _package_version() -> Optional[str]:
    """cactus-needle's own version, or None when the package isn't importable."""
    if _VERSION_CACHE["package"] is None and _PACKAGE is not None:
        _VERSION_CACHE["package"] = getattr(_PACKAGE, "__version__", "unknown")
    return _VERSION_CACHE["package"]


def _depth_of(weights: Optional[str]) -> Optional[int]:
    """Layer count of the active rung, parsed from a name like needle3-4L.cact.

    `weights is None` means the full model, which is the 20-layer base. Returns
    None for a tuned/custom archive whose depth isn't encoded in the filename.
    """
    if not weights:
        return 20
    match = re.search(r"-(\d+)L\.cact$", os.path.basename(weights))
    return int(match.group(1)) if match else None


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
        "model": "needle3",
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


def _get_agent(needle_tools: list):
    """Return a cached Needle agent for this tool set, building it on first use.

    Construction is the expensive step (7-48s); inference on a built agent is
    ~2-4s. The agent is stateless, so it is safe to reuse across requests.
    """
    key = _cache_key("", needle_tools)
    agent = _AGENTS.get(key)
    if agent is not None:
        return agent
    if len(_AGENTS) >= _AGENT_MAX_ENTRIES:
        _AGENTS.pop(next(iter(_AGENTS)), None)
    agent = _PACKAGE.Needle(
        tools=needle_tools, weights=_weights_path(_WEIGHTS), stateless=True
    )
    _AGENTS[key] = agent
    return agent


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
        # Needle's complete() is synchronous C inference; offload to thread pool
        # so it doesn't block the uvicorn event loop. The agent is cached, so
        # only the first request for a given tool set pays construction cost.
        def _infer():
            return _get_agent(needle_tools).complete(query, max_new_tokens=48)

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
                return _get_agent(needle_tools).complete(query, max_new_tokens=48)

            response_data = await asyncio.to_thread(_infer)
        except Exception as exc:
            logger.error("Needle 2 batch complete failed: %s", exc)
            results.append(
                {
                    "id": f"chatcmpl-needle-{int(time.time())}",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": "needle3",
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


@app.get("/admin/rungs")
async def list_rungs():
    """Every .cact rung sitting beside this service, plus which one is active."""
    base = _SERVICE_DIR
    try:
        names = os.listdir(base)
    except OSError as exc:
        return JSONResponse(status_code=500,
                            content={"error": {"message": str(exc)}})
    rungs = []
    for name in names:
        if not re.match(r"^needle3(-\d+L)?\.cact$", name):
            continue
        full = os.path.join(base, name)
        stat = os.stat(full)
        rungs.append({
            "file": name,
            "layers": _depth_of(name),
            "bytes": stat.st_size,
            "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stat.st_mtime)),
        })
    rungs.sort(key=lambda r: r["layers"] or 0)
    return {"rungs": rungs, "active": _WEIGHTS, "depth": _depth_of(_WEIGHTS)}


@app.post("/admin/reload")
async def reload_weights(request: Request):
    """Swap the active weights rung and drop all caches.

    Deliberately does NOT restart the process: clearing the agent + response
    caches is enough for the next request to rebuild against the new weights,
    and it avoids dropping in-flight requests. Re-warms in the background.

    `weights: null` selects the full (20-layer) base model.
    """
    global _WEIGHTS, _WARMED

    try:
        body = await request.json()
    except Exception:
        body = {}
    weights = body.get("weights") or None

    # Only a bare filename in this service's own directory is acceptable — a
    # path would let a caller point the engine at an arbitrary archive.
    if weights:
        if os.path.basename(weights) != weights:
            return JSONResponse(status_code=400, content={
                "error": {"message": "weights must be a bare filename, not a path"}})
        if not re.match(r"^needle3(-\d+L)?\.cact$", weights):
            return JSONResponse(status_code=400, content={
                "error": {"message": "weights must match needle3[-NL].cact"}})
        if not os.path.exists(os.path.join(_SERVICE_DIR, weights)):
            return JSONResponse(status_code=404, content={
                "error": {"message": f"{weights} not found in services/needle-router"}})

    _WEIGHTS = weights
    _AGENTS.clear()
    _CACHE.clear()
    _WARMED = False
    logger.info("Reloaded needle weights -> %s (depth %s)", _WEIGHTS, _depth_of(_WEIGHTS))
    asyncio.create_task(_warm_on_startup())

    return {
        "status": "ok",
        "weights": _WEIGHTS,
        "depth": _depth_of(_WEIGHTS),
        "warmed": False,
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "package_loaded": _PACKAGE is not None,
        "model": "needle3" if _WEIGHTS else "needle3-full",
        "weights": _WEIGHTS,
        "depth": _depth_of(_WEIGHTS),
        "package_version": _package_version(),
        "warmed": _WARMED,
        "cached_agents": len(_AGENTS),
    }


@app.on_event("startup")
async def _warm_on_startup() -> None:
    """Load the package and run one throwaway inference at boot.

    The first real request costs ~14s because `Needle(tools=...)` fetches and
    initialises the engine on demand. DMR-X's pre-filter budget is 1500ms
    (DMRX_NEEDLE_TIMEOUT_MS), so that first caller always times out and
    silently bypasses the pre-filter. Paying the cost here instead means the
    very first production request is already fast.

    Deliberately fire-and-forget: uvicorn must finish binding the port and
    start serving /health immediately, and a warmup failure must never stop
    the service from booting (the endpoints already degrade to 503/normal
    routing on their own).
    """
    async def _warm() -> None:
        global _WARMED
        try:
            await _ensure_package()
            if _PACKAGE is None:
                logger.warning("Warmup skipped: cactus-needle not importable.")
                return
            started = time.time()

            def _infer():
                agent = _PACKAGE.Needle(
                    tools=[{
                        "name": "warmup",
                        "description": "Warmup probe.",
                        "parameters": {"q": {"type": "string", "required": False}},
                    }],
                    weights=_weights_path(_WEIGHTS),
                    stateless=True,
                )
                return agent.complete("warmup", max_new_tokens=1)

            await asyncio.to_thread(_infer)
            _WARMED = True
            logger.info("Needle 2 warmed in %.1fs — pre-filter is live.", time.time() - started)
        except Exception as exc:  # noqa: BLE001 - warmup must never break boot
            logger.warning("Needle 2 warmup failed (%s). First request will load lazily.", exc)

    asyncio.create_task(_warm())


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8011, workers=2)
