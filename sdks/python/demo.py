"""
DMR-X Python SDK — Quick Demo

Run against any running DMR-X gateway:

    python demo.py

Set environment variables or edit below:
    DMRX_API_KEY=<your-api-key>
    DMRX_BASE_URL=http://localhost:3000
"""

import os
import sys

# ── Configuration ─────────────────────────────────────────────────
API_KEY = os.environ.get("DMRX_API_KEY", "dmrx_dev_key")
BASE_URL = os.environ.get("DMRX_BASE_URL", "http://localhost:3000")

# ── Demo ──────────────────────────────────────────────────────────
def demo_chat_sync(client):
    """Basic chat completion (sync)."""
    print("\n=== 1. Sync Chat Completion ===")
    print("Model: auto-coding | Messages: 1 (user)")

    response = client.chat.completions.create(
        model="auto-coding",
        messages=[{"role": "user", "content": "Write a one-line Python joke."}],
        temperature=0.7,
        max_tokens=100,
    )

    print(f"  Provider: {response.provider or 'auto-selected'}")
    print(f"  Model:    {response.model}")
    print(f"  Reply:    {response.choices[0].message.content}")
    print(f"  Tokens:   {response.usage.total_tokens if response.usage else 'N/A'}")

def demo_chat_stream(client):
    """Streaming chat completion."""
    print("\n=== 2. Streaming Chat Completion ===")
    print("Streaming response: ", end="", flush=True)

    stream = client.chat.completions.create(
        model="auto",
        messages=[{"role": "user", "content": "Count from 1 to 5."}],
        stream=True,
        max_tokens=200,
    )

    for chunk in stream:
        if chunk.type == "token":
            print(chunk.data.get("content", ""), end="", flush=True)
        elif chunk.type == "done":
            print()
            print(f"  [Done — finish reason: {chunk.data.get('finishReason')}]")

def demo_meta_models(client):
    """Test various meta-model aliases."""
    print("\n=== 3. Meta-Model Aliases ===")

    aliases = ["auto-fast", "auto-smart", "auto-agentic", "auto-coding"]
    for alias in aliases:
        try:
            resp = client.chat.completions.create(
                model=alias,
                messages=[{"role": "user", "content": "Say 'ok'"}],
                max_tokens=10,
            )
            print(f"  {alias:20s} → {resp.model:30s} ({resp.provider or 'auto'})")
        except Exception as e:
            print(f"  {alias:20s} → ERROR: {e}")

def demo_models(client):
    """List available models."""
    print("\n=== 4. Available Models ===")
    models = client.models.list()
    for model in models.data[:10]:
        print(f"  {model.id:40s} (by {model.owned_by})")
    if len(models.data) > 10:
        print(f"  ... and {len(models.data) - 10} more")

def demo_routing_params(client):
    """Chat with DMR-X specific routing parameters."""
    print("\n=== 5. Routing Parameters ===")

    response = client.chat.completions.create(
        model="auto",
        messages=[{"role": "user", "content": "What model are you?"}],
        quality="frontier",
        latency_target="2000ms",
        max_tokens=50,
    )

    content = response.choices[0].message.content
    print("  Quality: frontier")
    print(f"  Model:   {response.model}")
    print(f"  Reply:   {content[:100]}...")

def main():
    from dmrx import DMRXClient

    print("╔══════════════════════════════════════════╗")
    print("║     DMR-X Python SDK Demo v0.1.0        ║")
    print("╠══════════════════════════════════════════╣")
    print(f"║  Gateway: {BASE_URL}")
    print(f"║  API Key: {API_KEY[:8]}...{API_KEY[-4:]}")
    print("╚══════════════════════════════════════════╝")

    client = DMRXClient(api_key=API_KEY, base_url=BASE_URL)

    try:
        demo_chat_sync(client)
        demo_chat_stream(client)
        demo_meta_models(client)
        demo_models(client)
        demo_routing_params(client)

        print("\n✅ Demo complete!")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("   Make sure your DMR-X gateway is running and API key is valid.")
        print(f"   Gateway URL: {BASE_URL}")
        sys.exit(1)
    finally:
        client.close()


if __name__ == "__main__":
    main()
