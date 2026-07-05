"""
MLflow tracking integration for DMR-X Python SDK.

Provides a ``DMRXCallback`` implementation that logs all DMR-X API
calls to MLflow (https://mlflow.org).

Usage:
    from dmrx.integrations.mlflow import MLflowCallback

    client = DMRXClient(
        api_key="dmrx_...",
        observe=MLflowCallback(),
    )

Environment variables:
    MLFLOW_TRACKING_URI       — MLflow tracking server URI
    MLFLOW_EXPERIMENT_NAME    — Experiment name (default: "dmrx")
    MLFLOW_RUN_NAME           — Run name template
"""

from __future__ import annotations

import itertools
import json
import os
import time
from typing import Any, Dict, Optional

try:
    import mlflow

    HAS_MLFLOW = True
except ImportError:
    HAS_MLFLOW = False

from dmrx.callbacks import DMRXCallback


# ── Helpers ─────────────────────────────────────────────────────────


def _extract_input(body: Dict[str, Any]) -> str:
    """Extract a human-readable input string from a request body."""
    if "messages" in body:
        msgs = body["messages"]
        if isinstance(msgs, list):
            texts = []
            for m in msgs:
                content = m.get("content", "")
                if isinstance(content, list):
                    texts.append(
                        "[{} parts]".format(len(content))
                    )
                elif content:
                    texts.append(str(content)[:200])
            return " | ".join(texts) if texts else "(empty messages)"
    if "input" in body:
        inp = body["input"]
        if isinstance(inp, list):
            return "{} input(s)".format(len(inp))
        return str(inp)[:200]
    if "prompt" in body:
        return str(body["prompt"])[:200]
    return "(no input extracted)"


def _extract_output(response: Dict[str, Any]) -> Optional[str]:
    """Extract a human-readable output from a response."""
    choices = response.get("choices")
    if choices and isinstance(choices, list):
        msg = choices[0].get("message", {})
        content = msg.get("content")
        if content:
            return str(content)[:500]
        return "(tool call)" if msg.get("tool_calls") else None
    data = response.get("data")
    if data and isinstance(data, list):
        return "<{} result(s)>".format(len(data))
    text = response.get("text")
    if text:
        return str(text)[:500]
    return None


def _extract_usage(response: Dict[str, Any]) -> Dict[str, int]:
    """Extract token usage from a response."""
    usage = response.get("usage", {})
    if isinstance(usage, dict):
        return {
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }
    return {}


def _extract_metadata(body: Dict[str, Any]) -> Dict[str, Any]:
    """Extract metadata fields from request."""
    keys = {
        "quality", "provider_preference", "provider_blacklist",
        "latency_target", "cost_target", "local_first",
        "require_privacy", "user", "n", "seed",
    }
    return {k: body[k] for k in keys if k in body}


# ── Callback Implementation ────────────────────────────────────────


if HAS_MLFLOW:

    class MLflowCallback(DMRXCallback):
        """
        MLflow callback for DMR-X API observability.

        Logs each DMR-X API call as an MLflow run under the configured
        experiment. Works both in auto-run mode (creates a run per
        request) and in manual-run mode (logs within an externally
        started MLflow run).

        Args:
            experiment_name: MLflow experiment name.
                Defaults to the ``MLFLOW_EXPERIMENT_NAME`` env var
                or ``"dmrx"``.
            tracking_uri: MLflow tracking server URI.
                Defaults to the ``MLFLOW_TRACKING_URI`` env var
                or ``None`` (local filesystem).
            run_name_prefix: Prefix for auto-generated run names.
                Defaults to the endpoint name.
        """

        def __init__(
            self,
            experiment_name: Optional[str] = None,
            tracking_uri: Optional[str] = None,
            run_name_prefix: Optional[str] = None,
        ) -> None:
            self._experiment_name = experiment_name or os.environ.get(
                "MLFLOW_EXPERIMENT_NAME", "dmrx"
            )
            self._run_name_prefix = run_name_prefix or "dmrx"
            self._next_id = itertools.count(1).__next__

            if tracking_uri:
                mlflow.set_tracking_uri(tracking_uri)

            # Ensure the experiment exists
            mlflow.set_experiment(self._experiment_name)

            # Per-request state
            self._req_runs: Dict[int, Any] = {}
            self._req_start: Dict[int, float] = {}
            self._req_accum: Dict[int, str] = {}

        # ── Internal helpers ─────────────────────────────────────

        def _run_name(self, endpoint: str) -> str:
            """Generate a human-readable run name."""
            return f"{self._run_name_prefix}.{endpoint}"

        def _tag_params(
            self, body: Dict[str, Any], status: str = "ok"
        ) -> None:
            """Log request parameters as MLflow tags and params."""
            mlflow.set_tag("dmrx.endpoint", body.get("_endpoint", "unknown"))
            mlflow.set_tag("dmrx.model", body.get("model", "unknown"))
            mlflow.set_tag("dmrx.status", status)
            mlflow.set_tag("dmrx.sdk", "dmrx-python")

            model = body.get("model")
            if model:
                mlflow.log_param("model", model)

            # Log model parameters
            for key in (
                "temperature", "max_tokens", "top_p",
                "frequency_penalty", "presence_penalty",
            ):
                if key in body:
                    mlflow.log_param(key, body[key])

            # Log DMR-X specific routing params
            meta = _extract_metadata(body)
            for key, value in meta.items():
                if isinstance(value, (list, dict)):
                    mlflow.log_param(key, json.dumps(value))
                else:
                    mlflow.log_param(key, value)

        def _log_input(self, body: Dict[str, Any]) -> None:
            """Log the input to an MLflow text artifact."""
            input_text = _extract_input(body)
            mlflow.log_text(input_text, "input.txt")

        def _log_response(
            self, response: Dict[str, Any]
        ) -> None:
            """Log the full response as a JSON artifact."""
            mlflow.log_dict(response, "response.json")

            # Log token usage as metrics
            usage = _extract_usage(response)
            for key, value in usage.items():
                mlflow.log_metric(key, value)

            # Log provider info
            provider = response.get("provider")
            if provider:
                mlflow.set_tag("dmrx.provider", provider)
            latency = response.get("latency_ms")
            if latency is not None:
                mlflow.log_metric("gateway_latency_ms", latency)

            # Log output
            output = _extract_output(response)
            if output:
                mlflow.log_text(output, "output.txt")

        def _log_duration(self, duration_ms: float) -> None:
            """Log the request duration metric."""
            mlflow.log_metric("duration_ms", duration_ms)

        # ── Non-streaming lifecycle ─────────────────────────────

        def on_request_start(
            self, endpoint: str, body: Dict[str, Any]
        ) -> None:
            req_id = self._next_id()
            self._req_start[req_id] = time.monotonic()

            # Start a new MLflow run if none active
            body["_endpoint"] = endpoint
            run = mlflow.start_run(
                run_name=self._run_name(endpoint),
                nested=bool(mlflow.active_run()),
            )
            self._req_runs[req_id] = run

            self._tag_params(body)
            self._log_input(body)

        def on_request_end(
            self,
            endpoint: str,
            body: Dict[str, Any],
            response: Dict[str, Any],
            duration_ms: float,
        ) -> None:
            req_id = self._next_id() - 1
            if req_id not in self._req_runs:
                return

            run = self._req_runs.pop(req_id, None)
            self._req_start.pop(req_id, None)

            if run is None:
                return

            # Keep this run as active for logging
            try:
                self._log_duration(duration_ms)
                self._log_response(response)
            finally:
                mlflow.end_run(status="FINISHED")

        def on_request_error(
            self,
            endpoint: str,
            body: Dict[str, Any],
            error: Exception,
            duration_ms: float,
        ) -> None:
            req_id = self._next_id() - 1
            if req_id not in self._req_runs:
                return

            run = self._req_runs.pop(req_id, None)
            self._req_start.pop(req_id, None)

            if run is None:
                return

            try:
                self._log_duration(duration_ms)
                mlflow.set_tag("dmrx.status", "error")
                mlflow.set_tag("dmrx.error_type", type(error).__name__)
                mlflow.log_param("error_message", str(error)[:500])
            finally:
                mlflow.end_run(status="FAILED")

        # ── Streaming lifecycle ─────────────────────────────────

        def on_stream_start(
            self, endpoint: str, body: Dict[str, Any]
        ) -> None:
            req_id = self._next_id()
            self._req_start[req_id] = time.monotonic()
            self._req_accum[req_id] = ""

            body["_endpoint"] = endpoint
            run = mlflow.start_run(
                run_name=self._run_name(endpoint) + ".stream",
                nested=bool(mlflow.active_run()),
            )
            self._req_runs[req_id] = run

            self._tag_params(body, status="streaming")
            self._log_input(body)
            mlflow.set_tag("dmrx.stream", "true")

        def on_stream_chunk(
            self,
            endpoint: str,
            body: Dict[str, Any],
            chunk: Dict[str, Any],
        ) -> None:
            req_id = self._next_id() - 1
            if req_id not in self._req_accum:
                return

            content = chunk.get("data", {}).get("content", "")
            if content:
                self._req_accum[req_id] += content

        def on_stream_end(
            self,
            endpoint: str,
            body: Dict[str, Any],
            final_data: Dict[str, Any],
            duration_ms: float,
        ) -> None:
            req_id = self._next_id() - 1
            if req_id not in self._req_runs:
                return

            run = self._req_runs.pop(req_id, None)
            accumulated = self._req_accum.pop(req_id, "")
            self._req_start.pop(req_id, None)

            if run is None:
                return

            try:
                self._log_duration(duration_ms)

                # Log accumulated output
                if accumulated:
                    mlflow.log_text(accumulated, "output.txt")

                # Log usage from final data
                usage = final_data.get("usage")
                if usage:
                    token_keys = {
                        "prompt_tokens", "completion_tokens",
                        "total_tokens",
                    }
                    for key in token_keys:
                        if key in usage:
                            mlflow.log_metric(key, usage[key])

                # Log model ID
                model_id = final_data.get("modelId")
                if model_id:
                    mlflow.set_tag("dmrx.model_id", model_id)

                mlflow.set_tag("dmrx.status", "completed")
            finally:
                mlflow.end_run(status="FINISHED")

        def on_stream_error(
            self,
            endpoint: str,
            body: Dict[str, Any],
            error: Exception,
            duration_ms: float,
        ) -> None:
            req_id = self._next_id() - 1
            if req_id not in self._req_runs:
                return

            run = self._req_runs.pop(req_id, None)
            self._req_accum.pop(req_id, None)
            self._req_start.pop(req_id, None)

            if run is None:
                return

            try:
                self._log_duration(duration_ms)
                mlflow.set_tag("dmrx.status", "error")
                mlflow.set_tag("dmrx.error_type", type(error).__name__)
                mlflow.log_param("error_message", str(error)[:500])
            finally:
                mlflow.end_run(status="FAILED")

else:

    class MLflowCallback(DMRXCallback):  # type: ignore[no-redef]
        """Stub that raises an informative ImportError when instantiated."""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            raise ImportError(
                "MLflow is not installed. "
                "Install it with: pip install dmrx[mlflow]"
                "  or: pip install mlflow"
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
