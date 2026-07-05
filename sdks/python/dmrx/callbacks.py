"""
Observability callback interface for DMR-X Python SDK.

Provides a hook-based system for integrating with observability
platforms like Langfuse and MLflow. Callbacks fire at key points
in the request lifecycle:

    - on_request_start / on_request_end / on_request_error
      (non-streaming requests)
    - on_stream_start / on_stream_chunk / on_stream_end / on_stream_error
      (streaming requests)

Usage:
    from dmrx.callbacks import DMRXCallback

    class MyCallback(DMRXCallback):
        def on_request_start(self, endpoint, body):
            print(f"Starting {endpoint}")

    client = DMRXClient(api_key="...", observe=MyCallback())
"""

from __future__ import annotations

import logging
import os
from abc import ABC
from typing import Any, Dict, List, Optional, Union

_logger = logging.getLogger("dmrx.callbacks")


# ── Base Callback Interface ─────────────────────────────────────────


class DMRXCallback(ABC):
    """
    Abstract base class for DMR-X observability callbacks.

    All methods are no-ops by default — override only the ones you need.
    Methods are called synchronously and should complete quickly.
    For network-intensive work (e.g. sending traces), use fire-and-forget
    or an internal queue.
    """

    # ── Non-streaming request lifecycle ──────────────────────────

    def on_request_start(
        self,
        endpoint: str,
        body: Dict[str, Any],
    ) -> None:
        """
        Called before a non-streaming API request.

        Args:
            endpoint: API endpoint path, e.g. "chat.completions",
                      "embeddings", "images.generations".
            body: The full request body dict (model, messages, params, etc.).
        """

    def on_request_end(
        self,
        endpoint: str,
        body: Dict[str, Any],
        response: Dict[str, Any],
        duration_ms: float,
    ) -> None:
        """
        Called after a successful non-streaming API response.

        Args:
            endpoint: API endpoint path.
            body: The original request body.
            response: The parsed JSON response dict.
            duration_ms: Total request duration in milliseconds.
        """

    def on_request_error(
        self,
        endpoint: str,
        body: Dict[str, Any],
        error: Exception,
        duration_ms: float,
    ) -> None:
        """
        Called when a non-streaming API request fails.

        Args:
            endpoint: API endpoint path.
            body: The original request body.
            error: The exception that was raised.
            duration_ms: Elapsed milliseconds before the failure.
        """

    # ── Streaming request lifecycle ─────────────────────────────

    def on_stream_start(
        self,
        endpoint: str,
        body: Dict[str, Any],
    ) -> None:
        """
        Called before a streaming API request begins.

        Args:
            endpoint: API endpoint path.
            body: The full request body dict.
        """

    def on_stream_chunk(
        self,
        endpoint: str,
        body: Dict[str, Any],
        chunk: Dict[str, Any],
    ) -> None:
        """
        Called for each successfully parsed streaming chunk.

        Args:
            endpoint: API endpoint path.
            body: The original request body.
            chunk: Parsed chunk data dict (type, data, index, etc.).
        """

    def on_stream_end(
        self,
        endpoint: str,
        body: Dict[str, Any],
        final_data: Dict[str, Any],
        duration_ms: float,
    ) -> None:
        """
        Called when a streaming request completes successfully.

        Args:
            endpoint: API endpoint path.
            body: The original request body.
            final_data: The final "done" chunk data (requestId, modelId,
                       usage, finishReason).
            duration_ms: Total streaming duration in milliseconds.
        """

    def on_stream_error(
        self,
        endpoint: str,
        body: Dict[str, Any],
        error: Exception,
        duration_ms: float,
    ) -> None:
        """
        Called when a streaming request fails.

        Args:
            endpoint: API endpoint path.
            body: The original request body.
            error: The exception that was raised.
            duration_ms: Elapsed milliseconds before the failure.
        """


# ── Callback Manager ──────────────────────────────────────────────


class CallbackManager:
    """
    Manages a list of DMRXCallback instances, dispatching events to all.

    This is an internal helper that normalizes the various ways users
    can pass callbacks (single instance, list, string name, env var).

    Callback errors are logged but never propagated — a misbehaving
    callback will not crash the caller's request.
    """

    def __init__(
        self,
        callbacks: Optional[
            Union[
                DMRXCallback,
                List[DMRXCallback],
                str,
                None,
            ]
        ] = None,
    ) -> None:
        self._callbacks: List[DMRXCallback] = _normalize_callbacks(callbacks)

    def __bool__(self) -> bool:
        return len(self._callbacks) > 0

    @property
    def callbacks(self) -> List[DMRXCallback]:
        return list(self._callbacks)

    def _dispatch(self, method_name: str, *args: Any, **kwargs: Any) -> None:
        """Dispatch a method call to all callbacks, swallowing errors."""
        for cb in self._callbacks:
            try:
                getattr(cb, method_name)(*args, **kwargs)
            except Exception:
                _logger.exception(
                    "Callback %s.%s raised an error",
                    type(cb).__name__,
                    method_name,
                )

    # ── Non-streaming dispatch ──────────────────────────────────

    def on_request_start(self, endpoint: str, body: Dict[str, Any]) -> None:
        self._dispatch("on_request_start", endpoint, body)

    def on_request_end(
        self,
        endpoint: str,
        body: Dict[str, Any],
        response: Dict[str, Any],
        duration_ms: float,
    ) -> None:
        self._dispatch("on_request_end", endpoint, body, response, duration_ms)

    def on_request_error(
        self,
        endpoint: str,
        body: Dict[str, Any],
        error: Exception,
        duration_ms: float,
    ) -> None:
        self._dispatch("on_request_error", endpoint, body, error, duration_ms)

    # ── Streaming dispatch ──────────────────────────────────────

    def on_stream_start(self, endpoint: str, body: Dict[str, Any]) -> None:
        self._dispatch("on_stream_start", endpoint, body)

    def on_stream_chunk(
        self, endpoint: str, body: Dict[str, Any], chunk: Dict[str, Any]
    ) -> None:
        self._dispatch("on_stream_chunk", endpoint, body, chunk)

    def on_stream_end(
        self,
        endpoint: str,
        body: Dict[str, Any],
        final_data: Dict[str, Any],
        duration_ms: float,
    ) -> None:
        self._dispatch("on_stream_end", endpoint, body, final_data, duration_ms)

    def on_stream_error(
        self,
        endpoint: str,
        body: Dict[str, Any],
        error: Exception,
        duration_ms: float,
    ) -> None:
        self._dispatch("on_stream_error", endpoint, body, error, duration_ms)


# ── Normalisation Helpers ─────────────────────────────────────────


def _normalize_callbacks(
    observe: Optional[Union[DMRXCallback, List[DMRXCallback], str, bool]],
) -> List[DMRXCallback]:
    """
    Convert the various forms of the ``observe`` parameter into a list
    of ``DMRXCallback`` instances.

    Rules:
    - ``None`` / ``False`` / ``[]`` → empty list.
    - A single ``DMRXCallback`` instance → wrapped in a list.
    - A list of ``DMRXCallback`` → returned as-is.
    - The string ``"langfuse"`` → auto-create ``LangfuseCallback`` from env.
    - The string ``"mlflow"`` → auto-create ``MLflowCallback`` from env.
    - ``True`` → read the ``DMRX_OBSERVABILITY_BACKEND`` env var.
    """
    if observe is None or observe is False:
        return []
    if isinstance(observe, str):
        return _auto_create(observe)
    if observe is True:
        backend = os.environ.get("DMRX_OBSERVABILITY_BACKEND", "").strip().lower()
        if backend:
            return _auto_create(backend)
        return []
    if isinstance(observe, list):
        return list(observe)
    # Single DMRXCallback instance
    return [observe]


def _auto_create(backend: str) -> List[DMRXCallback]:
    """Auto-create a callback for the given backend name."""
    backend = backend.strip().lower()

    if backend == "langfuse":
        try:
            from dmrx.integrations.langfuse import LangfuseCallback

            return [LangfuseCallback()]
        except ImportError as exc:
            raise ImportError(
                "Langfuse integration requested but langfuse package is not installed. "
                "Install it with: pip install dmrx[langfuse]"
            ) from exc

    if backend == "mlflow":
        try:
            from dmrx.integrations.mlflow import MLflowCallback

            return [MLflowCallback()]
        except ImportError as exc:
            raise ImportError(
                "MLflow integration requested but mlflow package is not installed. "
                "Install it with: pip install dmrx[mlflow]"
            ) from exc

    raise ValueError(
        f"Unknown observability backend: {backend!r}. "
        f"Supported values: 'langfuse', 'mlflow'."
    )
