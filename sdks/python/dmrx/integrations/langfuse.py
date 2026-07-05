"""
Langfuse observability integration for DMR-X Python SDK.

Provides a ``DMRXCallback`` implementation that automatically traces
all DMR-X API calls to Langfuse (https://langfuse.com).

Usage:
    from dmrx.integrations.langfuse import LangfuseCallback

    client = DMRXClient(
        api_key="dmrx_...",
        observe=LangfuseCallback(),
    )

Environment variables:
    LANGFUSE_PUBLIC_KEY   — Langfuse project public key
    LANGFUSE_SECRET_KEY   — Langfuse project secret key
    LANGFUSE_HOST         — Langfuse server URL (default: https://cloud.langfuse.com)
    LANGFUSE_RELEASE      — Release version tag for traces
"""

from __future__ import annotations

import itertools
import os
import time
from typing import Any, Dict, Optional

try:
    from langfuse import Langfuse
    from langfuse.model import Usage

    HAS_LANGFUSE = True
except ImportError:
    HAS_LANGFUSE = False

from dmrx.callbacks import DMRXCallback


# ── Callback Implementation ────────────────────────────────────────


if HAS_LANGFUSE:

    class LangfuseCallback(DMRXCallback):
        """
        Langfuse callback for DMR-X API observability.

        Creates a Langfuse trace and generation span for each API call.
        Handles both streaming and non-streaming requests, capturing
        model parameters, token usage, latency, and error details.

        Args:
            public_key: Langfuse project public key.
                        Defaults to the ``LANGFUSE_PUBLIC_KEY`` env var.
            secret_key: Langfuse project secret key.
                        Defaults to the ``LANGFUSE_SECRET_KEY`` env var.
            host: Langfuse server URL.
                  Defaults to the ``LANGFUSE_HOST`` env var or
                  ``https://cloud.langfuse.com``.
            release: Release version tag attached to every trace.
                     Defaults to the ``LANGFUSE_RELEASE`` env var.
            langfuse_instance: An already-configured ``Langfuse`` instance.
                               If provided, *public_key*, *secret_key*,
                               *host*, and *release* are ignored.
        """

        def __init__(
            self,
            public_key: Optional[str] = None,
            secret_key: Optional[str] = None,
            host: Optional[str] = None,
            release: Optional[str] = None,
            langfuse_instance: Optional[Langfuse] = None,
        ) -> None:
            if langfuse_instance is not None:
                self._langfuse = langfuse_instance
            else:
                self._langfuse = Langfuse(
                    public_key=public_key
                    or os.environ.get("LANGFUSE_PUBLIC_KEY"),
                    secret_key=secret_key
                    or os.environ.get("LANGFUSE_SECRET_KEY"),
                    host=host
                    or os.environ.get(
                        "LANGFUSE_HOST", "https://cloud.langfuse.com"
                    ),
                    release=release or os.environ.get("LANGFUSE_RELEASE"),
                )

            # Per-request state keyed by id(body) for correlation
            # between start/end/error callbacks.
            self._next_id = itertools.count(1).__next__
            self._req_start: Dict[int, float] = {}
            self._req_traces: Dict[int, Any] = {}
            self._req_generations: Dict[int, Any] = {}
            # Streaming accumulation
            self._req_buffers: Dict[int, str] = {}

        # ── Helpers ──────────────────────────────────────────────

        def _trace_name(self, endpoint: str) -> str:
            """Human-readable trace name from an endpoint path."""
            return f"dmrx.{endpoint}"

        def _model_params(self, body: Dict[str, Any]) -> Dict[str, Any]:
            """Extract model parameters from a request body."""
            keys = {
                "temperature", "max_tokens", "top_p", "frequency_penalty",
                "presence_penalty", "seed", "n", "stop", "quality",
                "latency_target", "cost_target", "local_first",
                "require_privacy",
            }
            return {k: body[k] for k in keys if k in body}

        def _input_data(self, body: Dict[str, Any]) -> Any:
            """Extract user-facing input for Langfuse trace."""
            # Chat completions: messages
            if "messages" in body:
                return body["messages"]
            # Embeddings: input
            if "input" in body:
                return body["input"]
            # Images / video: prompt
            if "prompt" in body:
                return body["prompt"]
            # Audio speech: input
            if "input" in body:
                return body["input"]
            return {k: v for k, v in body.items() if k != "model"}

        def _output_data(
            self, response: Dict[str, Any]
        ) -> Optional[str]:
            """Extract user-facing output from a response."""
            # Chat completion
            choices = response.get("choices")
            if choices:
                msg = choices[0].get("message", {})
                content = msg.get("content")
                if content:
                    return content
            # Embedding
            data = response.get("data")
            if data and isinstance(data, list):
                return f"<{len(data)} embeddings>"
            # Images / video
            data = response.get("data")
            if data and isinstance(data, list):
                urls = [d.get("url", "") for d in data if d.get("url")]
                if urls:
                    return f"<{len(urls)} generated assets>"
            return None

        def _usage_from_response(
            self, response: Dict[str, Any]
        ) -> Optional[Dict[str, int]]:
            """Extract token usage from a response."""
            usage = response.get("usage")
            if usage and isinstance(usage, dict):
                return {
                    "input": usage.get("prompt_tokens", 0),
                    "output": usage.get("completion_tokens", 0),
                    "total": usage.get("total_tokens", 0),
                }
            return None

        # ── Non-streaming lifecycle ─────────────────────────────

        def on_request_start(
            self, endpoint: str, body: Dict[str, Any]
        ) -> None:
            req_id = self._next_id()
            self._req_start[req_id] = time.monotonic()

            trace_name = self._trace_name(endpoint)
            trace = self._langfuse.trace(
                name=trace_name,
                input=self._input_data(body),
                metadata={
                    "endpoint": endpoint,
                    "model": body.get("model"),
                    "sdk": "dmrx-python",
                },
            )
            self._req_traces[req_id] = trace

            # Create a generation span for the LLM/API call
            generation = trace.generation(
                name=trace_name,
                model=body.get("model", "unknown"),
                model_parameters=self._model_params(body),
                input=self._input_data(body),
                start_time=time.time(),
            )
            self._req_generations[req_id] = generation

        def on_request_end(
            self,
            endpoint: str,
            body: Dict[str, Any],
            response: Dict[str, Any],
            duration_ms: float,
        ) -> None:
            req_id = self._next_id() - 1  # the request that just finished
            if req_id not in self._req_generations:
                return

            generation = self._req_generations.pop(req_id, None)
            trace = self._req_traces.pop(req_id, None)
            self._req_start.pop(req_id, None)

            if generation is None:
                return

            usage = self._usage_from_response(response)
            output = self._output_data(response)

            # Extract provider info if present
            metadata: Dict[str, Any] = {"duration_ms": duration_ms}
            provider = response.get("provider")
            if provider:
                metadata["provider"] = provider
            latency_ms = response.get("latency_ms")
            if latency_ms is not None:
                metadata["gateway_latency_ms"] = latency_ms

            generation.end(
                output=output,
                usage=Usage(**usage) if usage else None,
                metadata=metadata,
                end_time=time.time(),
            )

            if trace is not None:
                trace.update(output=output)

            # Flush to ensure data is sent promptly
            self._langfuse.flush()

        def on_request_error(
            self,
            endpoint: str,
            body: Dict[str, Any],
            error: Exception,
            duration_ms: float,
        ) -> None:
            req_id = self._next_id() - 1
            if req_id not in self._req_generations:
                return

            generation = self._req_generations.pop(req_id, None)
            trace = self._req_traces.pop(req_id, None)
            self._req_start.pop(req_id, None)

            if generation is None:
                return

            error_meta = {
                "error_type": type(error).__name__,
                "error_message": str(error),
                "duration_ms": duration_ms,
            }

            generation.end(
                output=None,
                metadata=error_meta,
                level="ERROR",
                status_message=str(error),
                end_time=time.time(),
            )

            if trace is not None:
                trace.update(
                    output=None,
                    metadata={**error_meta, "status": "error"},
                )

            self._langfuse.flush()

        # ── Streaming lifecycle ─────────────────────────────────

        def on_stream_start(
            self, endpoint: str, body: Dict[str, Any]
        ) -> None:
            req_id = self._next_id()
            self._req_start[req_id] = time.monotonic()
            self._req_buffers[req_id] = ""

            trace_name = self._trace_name(endpoint)
            trace = self._langfuse.trace(
                name=trace_name,
                input=self._input_data(body),
                metadata={
                    "endpoint": endpoint,
                    "model": body.get("model"),
                    "stream": True,
                    "sdk": "dmrx-python",
                },
            )
            self._req_traces[req_id] = trace

            generation = trace.generation(
                name=trace_name,
                model=body.get("model", "unknown"),
                model_parameters=self._model_params(body),
                input=self._input_data(body),
                start_time=time.time(),
            )
            self._req_generations[req_id] = generation

        def on_stream_chunk(
            self,
            endpoint: str,
            body: Dict[str, Any],
            chunk: Dict[str, Any],
        ) -> None:
            req_id = self._next_id() - 1
            if req_id not in self._req_buffers:
                return

            # Accumulate text content
            content = chunk.get("data", {}).get("content", "")
            if content:
                self._req_buffers[req_id] += content

        def on_stream_end(
            self,
            endpoint: str,
            body: Dict[str, Any],
            final_data: Dict[str, Any],
            duration_ms: float,
        ) -> None:
            req_id = self._next_id() - 1
            if req_id not in self._req_generations:
                return

            generation = self._req_generations.pop(req_id, None)
            trace = self._req_traces.pop(req_id, None)
            accumulated = self._req_buffers.pop(req_id, "")
            self._req_start.pop(req_id, None)

            if generation is None:
                return

            # Build usage from final data if available
            usage_raw = final_data.get("usage")
            usage = (
                Usage(
                    input=usage_raw.get("prompt_tokens", 0),
                    output=usage_raw.get("completion_tokens", 0),
                    total=usage_raw.get("total_tokens", 0),
                )
                if usage_raw
                else None
            )

            metadata: Dict[str, Any] = {"duration_ms": duration_ms, "stream": True}
            model_id = final_data.get("modelId")
            if model_id:
                metadata["model_id"] = model_id

            generation.end(
                output=accumulated or None,
                usage=usage,
                metadata=metadata,
                end_time=time.time(),
            )

            if trace is not None:
                trace.update(output=accumulated or None)

            self._langfuse.flush()

        def on_stream_error(
            self,
            endpoint: str,
            body: Dict[str, Any],
            error: Exception,
            duration_ms: float,
        ) -> None:
            req_id = self._next_id() - 1
            if req_id not in self._req_generations:
                return

            generation = self._req_generations.pop(req_id, None)
            trace = self._req_traces.pop(req_id, None)
            self._req_buffers.pop(req_id, None)
            self._req_start.pop(req_id, None)

            if generation is None:
                return

            generation.end(
                output=None,
                metadata={
                    "error": str(error),
                    "error_type": type(error).__name__,
                    "duration_ms": duration_ms,
                    "stream": True,
                },
                level="ERROR",
                status_message=str(error),
                end_time=time.time(),
            )

            if trace is not None:
                trace.update(
                    output=None,
                    metadata={"status": "error", "error": str(error)},
                )

            self._langfuse.flush()

else:

    class LangfuseCallback(DMRXCallback):  # type: ignore[no-redef]
        """Stub that raises an informative ImportError when instantiated."""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            raise ImportError(
                "Langfuse is not installed. "
                "Install it with: pip install dmrx[langfuse]"
                "  or: pip install langfuse"
            )

        def on_request_start(self, endpoint: str, body: Dict[str, Any]) -> None:
            pass

        def on_request_end(
            self,
            endpoint: str,
            body: Dict[str, Any],
            response: Dict[str, Any],
            duration_ms: float,
        ) -> None:
            pass

        def on_request_error(
            self,
            endpoint: str,
            body: Dict[str, Any],
            error: Exception,
            duration_ms: float,
        ) -> None:
            pass

        def on_stream_start(self, endpoint: str, body: Dict[str, Any]) -> None:
            pass

        def on_stream_chunk(
            self,
            endpoint: str,
            body: Dict[str, Any],
            chunk: Dict[str, Any],
        ) -> None:
            pass

        def on_stream_end(
            self,
            endpoint: str,
            body: Dict[str, Any],
            final_data: Dict[str, Any],
            duration_ms: float,
        ) -> None:
            pass

        def on_stream_error(
            self,
            endpoint: str,
            body: Dict[str, Any],
            error: Exception,
            duration_ms: float,
        ) -> None:
            pass
