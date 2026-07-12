"""
DMR-X Observability Quickstart — Langfuse + MLflow.

This example shows how to enable observability on your DMR-X client.
Choose one of:

1. Langfuse auto-config from env vars
2. MLflow auto-config from env vars
3. Custom callback (extend DMRXCallback)

Prerequisites:
    pip install dmrx[langfuse]   # for Langfuse support
    pip install dmrx[mlflow]     # for MLflow support

Environment variables (Langfuse):
    export LANGFUSE_PUBLIC_KEY="pk-..."
    export LANGFUSE_SECRET_KEY="sk-..."
    export LANGFUSE_HOST="https://cloud.langfuse.com"  # optional

Environment variables (MLflow):
    export MLFLOW_TRACKING_URI="http://localhost:5000"  # optional
    export MLFLOW_EXPERIMENT_NAME="dmrx-demo"           # optional

DMR-X auto-detection:
    export DMRX_OBSERVABILITY_BACKEND="langfuse"  # or "mlflow"
"""

import os

# ── Option 1: Auto-config via environment variables ─────────────
#
# Set DMRX_OBSERVABILITY_BACKEND=langfuse (or mlflow) before
# importing DMRXClient. The client will auto-create the callback.
#
# Or just pass observe=True and it reads the env var.
# -----------------------------------------------------------------

def demo_auto_detect():
    """If DMRX_OBSERVABILITY_BACKEND is set, True auto-creates."""
    from dmrx import DMRXClient

    # ``observe=True`` reads ``DMRX_OBSERVABILITY_BACKEND`` from env.
    # If the env var is not set, it's a no-op.
    backend = os.environ.get("DMRX_OBSERVABILITY_BACKEND", "")
    if not backend:
        print("Set DMRX_OBSERVABILITY_BACKEND to enable auto-detect.")
        return

    client = DMRXClient(
        api_key="dmrx_...",
        base_url="http://localhost:3000",
        observe=True,
    )
    print(f"Auto-detected backend: {backend}")
    print(f"  Active callbacks: {len(client.chat.completions._callbacks.callbacks)}")
    client.close()


# ── Option 2: Explicit LangfuseCallback ─────────────────────────
#
# Pass a LangfuseCallback instance directly. You can configure it
# with explicit credentials or rely on environment variables.
# -----------------------------------------------------------------

def demo_langfuse_explicit():
    """Explicit Langfuse callback with env-var-based credentials."""
    from dmrx import DMRXClient
    from dmrx.integrations.langfuse import LangfuseCallback

    # Credentials are read from LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY
    # and LANGFUSE_HOST by default. You can also pass them explicitly:
    #   LangfuseCallback(public_key="pk-...", secret_key="sk-...")
    try:
        cb = LangfuseCallback()
    except ImportError as exc:
        print(f"  Skipped — {exc}")
        return

    client = DMRXClient(
        api_key="dmrx_...",
        base_url="http://localhost:3000",
        observe=cb,
    )

    # Every call is now automatically traced to Langfuse:
    #
    #   client.chat.completions.create(
    #       model="auto-coding",
    #       messages=[{"role": "user", "content": "Hello!"}],
    #   )
    #
    # This creates:
    #   - A Langfuse trace named "dmrx.chat.completions"
    #   - A generation span with model params, token usage, latency
    # For streaming, traces are accumulated and finalized at the end.

    print("Langfuse callback configured. Make API calls to see traces.")
    print(f"  Active callbacks: {len(client.chat.completions._callbacks.callbacks)}")

    # Don't forget to flush before exiting (Langfuse sends async)
    client.close()


# ── Option 3: Explicit MLflowCallback ──────────────────────────
#
# Pass an MLflowCallback instance. Each API call creates an MLflow
# run under the "dmrx" experiment (configurable).
# -----------------------------------------------------------------

def demo_mlflow_explicit():
    """Explicit MLflow callback."""
    from dmrx import DMRXClient
    from dmrx.integrations.mlflow import MLflowCallback

    try:
        cb = MLflowCallback(
            experiment_name="dmrx-demo",
            # tracking_uri="http://localhost:5000",  # optional
        )
    except ImportError as exc:
        print(f"  Skipped — {exc}")
        return

    client = DMRXClient(
        api_key="dmrx_...",
        base_url="http://localhost:3000",
        observe=cb,
    )

    # Every API call logs:
    #   - Params: model, temperature, max_tokens, quality, etc.
    #   - Metrics: duration_ms, prompt_tokens, completion_tokens
    #   - Artifacts: input.txt, output.txt, response.json

    print("MLflow callback configured. Make API calls to see runs.")
    print(f"  Active callbacks: {len(client.chat.completions._callbacks.callbacks)}")
    client.close()


# ── Option 4: Multiple callbacks ────────────────────────────────
#
# Pass a list of callbacks to enable multiple backends at once.
# -----------------------------------------------------------------

def demo_multiple_callbacks():
    """Multiple observability backends simultaneously."""
    from dmrx import DMRXClient
    from dmrx.integrations.langfuse import LangfuseCallback
    from dmrx.integrations.mlflow import MLflowCallback

    callbacks = []
    for name, Cls in [("langfuse", LangfuseCallback), ("mlflow", MLflowCallback)]:
        try:
            callbacks.append(Cls())
            print(f"  {name}: configured")
        except ImportError:
            print(f"  {name}: skipped (not installed)")

    if not callbacks:
        print("  No backends available.")
        return

    client = DMRXClient(
        api_key="dmrx_...",
        base_url="http://localhost:3000",
        observe=callbacks,
    )

    print(f"\n  {len(callbacks)} callback(s) active. All endpoints instrumented.")
    client.close()


# ── Option 5: Custom callback ───────────────────────────────────
#
# Implement DMRXCallback to integrate with any observability platform.
# -----------------------------------------------------------------

def demo_custom_callback():
    """Custom callback — log events to console."""
    from dmrx import DMRXClient, DMRXCallback


    class ConsoleCallback(DMRXCallback):
        """Log every API event to the console."""

        def on_request_start(self, endpoint, body):
            print(f"  ▶ {endpoint} — model: {body.get('model', 'N/A')}")

        def on_request_end(self, endpoint, body, response, duration_ms):
            print(f"  ✓ {endpoint} — {duration_ms:.1f}ms")

        def on_request_error(self, endpoint, body, error, duration_ms):
            print(f"  ✗ {endpoint} — {error} ({duration_ms:.1f}ms)")

        def on_stream_start(self, endpoint, body):
            print(f"  ▶ {endpoint} [stream]")

        def on_stream_chunk(self, endpoint, body, chunk):
            content = chunk.get("data", {}).get("content", "")
            if content:
                print(f"  ┊ {content}", end="")

        def on_stream_end(self, endpoint, body, final_data, duration_ms):
            print(f"\n  ✓ {endpoint} [stream done] — {duration_ms:.1f}ms")

        def on_stream_error(self, endpoint, body, error, duration_ms):
            print(f"\n  ✗ {endpoint} [stream error] — {error}")


    client = DMRXClient(
        api_key="dmrx_...",
        base_url="http://localhost:3000",
        observe=ConsoleCallback(),
    )

    print("Console callback configured. All events print to stdout.")
    print(f"  Active callbacks: {len(client.chat.completions._callbacks.callbacks)}")
    client.close()


# ── Main ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("═" * 55)
    print("  DMR-X Observability Quickstart")
    print("═" * 55)

    print("\n1. Auto-detect from DMRX_OBSERVABILITY_BACKEND env var")
    print("-" * 50)
    demo_auto_detect()

    print("\n2. Explicit LangfuseCallback")
    print("-" * 50)
    demo_langfuse_explicit()

    print("\n3. Explicit MLflowCallback")
    print("-" * 50)
    demo_mlflow_explicit()

    print("\n4. Multiple callbacks")
    print("-" * 50)
    demo_multiple_callbacks()

    print("\n5. Custom ConsoleCallback")
    print("-" * 50)
    demo_custom_callback()
