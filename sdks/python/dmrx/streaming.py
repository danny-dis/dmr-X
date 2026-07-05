"""
Streaming response parsing for DMR-X API.
Handles SSE (Server-Sent Events) and line-delimited JSON streams.
"""

from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator, Dict, Iterator, Optional

from .callbacks import CallbackManager
from .errors import DMRXError, map_error
from .types.shared import (
    DoneStreamChunk,
    ErrorStreamChunk,
    StreamChunk,
    TokenStreamChunk,
)


# ── SSE Parsing ────────────────────────────────────────────────────


def parse_sse_line(line: str) -> Optional[Dict[str, Any]]:
    """Parse a single SSE line into a key-value pair."""
    line = line.strip()
    if not line:
        return None
    colon_idx = line.find(":")
    if colon_idx == -1:
        return {line: ""}
    key = line[:colon_idx].strip()
    value = line[colon_idx + 1 :].strip()
    return {key: value}


def parse_sse_event(data_str: str) -> Optional[StreamChunk]:
    """
    Parse an SSE data payload into a structured StreamChunk.

    Supports:
    - OpenAI format: data: {"choices": [...]}
    - DMR-X native format: data: {"type": "token", "data": ..., "index": ...}
    - Anthropic format: event: content_block_delta / data: {...}
    """

    # DMR-X native format (chunks have 'type' and 'data' at top level)
    try:
        parsed = json.loads(data_str)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    chunk_type = parsed.get("type")

    # DMR-X native streaming chunks
    if chunk_type in ("token", "done", "error", "image_partial", "video_partial", "audio_chunk", "audio_partial"):
        if chunk_type == "token":
            return TokenStreamChunk(
                type="token",
                data=parsed.get("data", {}),
                index=parsed.get("index", 0),
            )
        elif chunk_type == "done":
            return DoneStreamChunk(
                type="done",
                data=parsed.get("data", {}),
                index=parsed.get("index", 0),
            )
        elif chunk_type == "error":
            return ErrorStreamChunk(
                type="error",
                data=parsed.get("data", {}),
                index=parsed.get("index", 0),
            )
        else:
            return StreamChunk(
                type=chunk_type,  # type: ignore
                data=parsed.get("data", {}),
                index=parsed.get("index", 0),
            )

    # OpenAI-compatible streaming format
    # data: {"id":"...","object":"chat.completion.chunk","choices":[{"delta":{...}}]}
    if parsed.get("object") == "chat.completion.chunk":
        choices = parsed.get("choices", [])
        content = ""
        tool_calls = []

        for choice in choices:
            delta = choice.get("delta", {})
            delta_content = delta.get("content")
            if delta_content is not None:
                content += delta_content
            delta_tool_calls = delta.get("tool_calls")
            if delta_tool_calls:
                tool_calls.extend(delta_tool_calls)

        finish_reason = choices[0].get("finish_reason") if choices else None

        if finish_reason:
            return DoneStreamChunk(
                type="done",
                data={
                    "requestId": parsed.get("id", ""),
                    "modelId": parsed.get("model", ""),
                    "finishReason": finish_reason,
                },
                index=0,
            )

        return TokenStreamChunk(
            type="token",
            data={
                "content": content if content else None,
                "tool_calls": tool_calls if tool_calls else None,
            },
            index=0,
        )

    return None


# ── Sync Stream ────────────────────────────────────────────────────


class Stream:
    """
    Synchronous streaming response iterator.

    Usage:
        with client.chat.stream(ChatCompletionRequest(...)) as stream:
            for chunk in stream:
                if isinstance(chunk, TokenStreamChunk):
                    print(chunk.data.get("content", ""), end="")
    """

    def __init__(
        self,
        lines: Iterator[str],
        *,
        endpoint: str = "",
        request_body: Optional[Dict[str, Any]] = None,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._lines = lines
        self._endpoint = endpoint
        self._request_body = request_body or {}
        self._callbacks = callbacks or CallbackManager()
        self._done = False
        self._start_time = time.monotonic()

    def __iter__(self) -> Iterator[StreamChunk]:
        return self._iter_chunks()

    def _iter_chunks(self) -> Iterator[StreamChunk]:
        buffer = ""

        for raw_line in self._lines:
            line = raw_line.strip()

            # Skip empty lines
            if not line:
                continue

            # Handle SSE event fields
            if line.startswith("event:"):
                # Anthropic-style events (event: ...)
                continue

            if line.startswith("data:"):
                data_str = line[5:].strip()

                # OpenAI stream end marker
                if data_str == "[DONE]":
                    self._done = True
                    duration = (time.monotonic() - self._start_time) * 1000
                    self._callbacks.on_stream_end(
                        self._endpoint,
                        self._request_body,
                        {"finishReason": "stop"},
                        duration,
                    )
                    return

                chunk = parse_sse_event(data_str)
                if chunk is not None:
                    yield from self._emit_chunk(chunk)
            elif line.startswith(":"):
                # SSE comment, skip
                continue
            else:
                # Plain JSON line (non-SSE)
                chunk = parse_sse_event(line)
                if chunk is not None:
                    yield from self._emit_chunk(chunk)

    def _emit_chunk(self, chunk: StreamChunk) -> Iterator[StreamChunk]:
        """Yield a chunk, firing callbacks as appropriate."""
        if isinstance(chunk, ErrorStreamChunk):
            duration = (time.monotonic() - self._start_time) * 1000
            error = DMRXError(
                chunk.data.get("message", "Stream error"),
                code=chunk.data.get("code", "STREAM_ERROR"),
            )
            self._callbacks.on_stream_error(
                self._endpoint, self._request_body, error, duration
            )
            yield chunk
            return

        if isinstance(chunk, DoneStreamChunk):
            self._done = True
            duration = (time.monotonic() - self._start_time) * 1000
            self._callbacks.on_stream_end(
                self._endpoint, self._request_body, chunk.data, duration
            )
            yield chunk
            return

        # Token or other intermediate chunk
        self._callbacks.on_stream_chunk(
            self._endpoint, self._request_body, chunk.model_dump()
        )
        yield chunk

    def close(self) -> None:
        """Close the underlying iterator if possible."""
        if hasattr(self._lines, "close"):
            self._lines.close()


# ── Async Stream ───────────────────────────────────────────────────


class AsyncStream:
    """
    Asynchronous streaming response iterator.

    Usage:
        async with client.chat.stream(ChatCompletionRequest(...)) as stream:
            async for chunk in stream:
                if isinstance(chunk, TokenStreamChunk):
                    print(chunk.data.get("content", ""), end="")
    """

    def __init__(
        self,
        lines: AsyncIterator[str],
        *,
        endpoint: str = "",
        request_body: Optional[Dict[str, Any]] = None,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._lines = lines
        self._endpoint = endpoint
        self._request_body = request_body or {}
        self._callbacks = callbacks or CallbackManager()
        self._done = False
        self._start_time = time.monotonic()

    def __aiter__(self) -> AsyncIterator[StreamChunk]:
        return self._iter_chunks()

    async def _iter_chunks(self) -> AsyncIterator[StreamChunk]:
        async for raw_line in self._lines:
            line = raw_line.strip()

            if not line:
                continue

            if line.startswith("event:"):
                continue

            if line.startswith("data:"):
                data_str = line[5:].strip()

                if data_str == "[DONE]":
                    self._done = True
                    duration = (time.monotonic() - self._start_time) * 1000
                    self._callbacks.on_stream_end(
                        self._endpoint,
                        self._request_body,
                        {"finishReason": "stop"},
                        duration,
                    )
                    return

                chunk = parse_sse_event(data_str)
                if chunk is not None:
                    async for c in self._emit_chunk_async(chunk):
                        yield c
            elif line.startswith(":"):
                continue
            else:
                chunk = parse_sse_event(line)
                if chunk is not None:
                    async for c in self._emit_chunk_async(chunk):
                        yield c

    async def _emit_chunk_async(
        self, chunk: StreamChunk
    ) -> AsyncIterator[StreamChunk]:
        """Yield a chunk asynchronously, firing callbacks as appropriate."""
        if isinstance(chunk, ErrorStreamChunk):
            duration = (time.monotonic() - self._start_time) * 1000
            error = DMRXError(
                chunk.data.get("message", "Stream error"),
                code=chunk.data.get("code", "STREAM_ERROR"),
            )
            self._callbacks.on_stream_error(
                self._endpoint, self._request_body, error, duration
            )
            yield chunk
            return

        if isinstance(chunk, DoneStreamChunk):
            self._done = True
            duration = (time.monotonic() - self._start_time) * 1000
            self._callbacks.on_stream_end(
                self._endpoint, self._request_body, chunk.data, duration
            )
            yield chunk
            return

        # Token or other intermediate chunk
        self._callbacks.on_stream_chunk(
            self._endpoint, self._request_body, chunk.model_dump()
        )
        yield chunk

    async def close(self) -> None:
        """Close the underlying async iterator."""
        if hasattr(self._lines, "aclose"):
            await self._lines.aclose()
