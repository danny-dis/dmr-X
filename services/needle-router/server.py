"""
Needle Router — a local, OpenAI-compatible tool-calling HTTP service.

Wraps the Needle 26M-param tool-calling model (cactus-compute/needle) and exposes
an OpenAI chat/completions-shaped endpoint so DMR-X can register it as a cheap
"which tool?" pre-router that runs BEFORE an expensive model.

Bind: 0.0.0.0:8011
"""

import json
import logging
import time
from typing import Any, List, Optional

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("needle-router")

app = FastAPI(title="Needle Router", version="0.1.0")

# Lazily-loaded model state. The checkpoint auto-downloads from HF on first
# request; if it (or the `needle` package) is missing the server still boots.
_MODEL = None
_PARAMS = None
_TOKENIZER = None
_MODEL_LOADED = False


def _load_model() -> None:
    """Load the Needle checkpoint lazily. Never raises — logs a warning instead."""
    global _MODEL, _PARAMS, _TOKENIZER, _MODEL_LOADED
    if _MODEL_LOADED:
        return
    _MODEL_LOADED = True
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

    _load_model()
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

        raw = generate(
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
    return JSONResponse(content=response)


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _MODEL is not None}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8011)
