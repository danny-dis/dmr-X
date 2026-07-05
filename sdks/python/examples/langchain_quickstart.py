"""
LangChain Quickstart with DMR-X.

This example demonstrates how to use DMR-X as a LangChain chat model
with streaming, tool calling, and DMR-X's meta-model aliases.

Usage:
    DMRX_API_KEY=dmrx_... python examples/langchain_quickstart.py
"""

import json
import os

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool

from dmrx.integrations.langchain import ChatDMRX

# ── Configuration ─────────────────────────────────────────────────
API_KEY = os.environ.get("DMRX_API_KEY", "dmrx_dev_key")
BASE_URL = os.environ.get("DMRX_BASE_URL", "http://localhost:3000")


def demo_basic():
    """Basic chat completion."""
    print("\n=== Basic Chat ===")
    llm = ChatDMRX(model="auto-coding", api_key=API_KEY, base_url=BASE_URL)
    response = llm.invoke([
        SystemMessage(content="You are a helpful assistant."),
        HumanMessage(content="Write a one-line joke about Python."),
    ])
    print(f"Response: {response.content}")


def demo_streaming():
    """Streaming chat completion."""
    print("\n=== Streaming Chat ===")
    llm = ChatDMRX(model="auto", api_key=API_KEY, base_url=BASE_URL)
    print("Streaming: ", end="", flush=True)
    for chunk in llm.stream([
        HumanMessage(content="Count from 1 to 10."),
    ]):
        print(chunk.content, end="", flush=True)
    print()


def demo_meta_models():
    """Test different meta-model aliases."""
    print("\n=== Meta-Model Aliases ===")
    for alias in ["auto-fast", "auto-smart", "auto-coding"]:
        llm = ChatDMRX(model=alias, api_key=API_KEY, base_url=BASE_URL)
        response = llm.invoke([HumanMessage(content="Say 'ok'")])
        print(f"  {alias:15s} \u2192 {response.content}")


def demo_tool_calling():
    """Tool calling with DMR-X."""
    print("\n=== Tool Calling ===")

    @tool
    def get_weather(location: str) -> str:
        """Get the weather for a location."""
        return f"The weather in {location} is 72\u00b0F and sunny."

    llm = ChatDMRX(model="auto-agentic", api_key=API_KEY, base_url=BASE_URL)
    llm_with_tools = llm.bind_tools([get_weather])

    response = llm_with_tools.invoke([
        HumanMessage(content="What's the weather in San Francisco?"),
    ])

    if response.tool_calls:
        for tc in response.tool_calls:
            print(f"  Tool: {tc['name']}({json.dumps(tc['args'])})")
    else:
        print(f"  Response: {response.content}")


def demo_routing_params():
    """DMR-X specific routing parameters."""
    print("\n=== Routing Parameters ===")
    llm = ChatDMRX(
        model="auto-smart",
        api_key=API_KEY,
        base_url=BASE_URL,
        quality="frontier",
        provider_preference=["openai", "anthropic"],
    )
    response = llm.invoke([HumanMessage(content="Which model are you running on?")])
    print(f"Response: {response.content}")
    print(f"Provider: {response.additional_kwargs.get('provider', 'N/A')}")


def main():
    print("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557")
    print("\u2551   DMR-X + LangChain Quickstart Demo     \u2551")
    print("\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d")
    print(f"Gateway: {BASE_URL}")

    try:
        demo_basic()
        demo_streaming()
        demo_meta_models()
        demo_tool_calling()
        demo_routing_params()
        print("\n\u2705 All demos completed!")
    except Exception as e:
        print(f"\n\u274c Error: {e}")
        print("Make sure your DMR-X gateway is running and API key is valid.")


if __name__ == "__main__":
    main()
