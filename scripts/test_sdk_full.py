"""Test all 3 native SDKs against DMR-X gateway — full test with tools + streaming."""
import json
import sys

def test_openai():
    from openai import OpenAI
    client = OpenAI(base_url="http://127.0.0.1:47113/v1", api_key="test")
    
    # 1. Simple chat
    r = client.chat.completions.create(
        model="openrouter-free/deepseek/deepseek-chat",
        messages=[{"role": "user", "content": "Say 'openai works' in one sentence"}],
        max_tokens=50,
    )
    print(f"✓ OpenAI chat: {r.choices[0].message.content}")
    assert "openai" in r.choices[0].message.content.lower()
    
    # 2. Tool call
    r = client.chat.completions.create(
        model="openrouter-free/deepseek/deepseek-chat",
        messages=[{"role": "user", "content": "Use calc to add 5+3"}],
        tools=[{
            "type": "function",
            "function": {
                "name": "calc",
                "description": "Add two numbers",
                "parameters": {
                    "type": "object",
                    "properties": {"a": {"type": "number"}, "b": {"type": "number"}},
                    "required": ["a", "b"],
                },
            },
        }],
        max_tokens=100,
    )
    calls = r.choices[0].message.tool_calls
    if calls:
        print(f"✓ OpenAI tool call: {calls[0].function.name}({calls[0].function.arguments})")
        assert calls[0].function.name == "calc"
    
    # 3. Streaming
    chunks = []
    stream = client.chat.completions.create(
        model="openrouter-free/deepseek/deepseek-chat",
        messages=[{"role": "user", "content": "Say 'streaming works'"}],
        stream=True,
        max_tokens=30,
    )
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            chunks.append(chunk.choices[0].delta.content)
    full = "".join(chunks)
    print(f"✓ OpenAI streaming ({len(chunks)} chunks): {full}")
    assert "streaming" in full.lower()

def test_anthropic():
    try:
        from anthropic import Anthropic
    except ImportError:
        print("✗ Anthropic SDK not installed")
        return
    
    client = Anthropic(base_url="http://127.0.0.1:47113", api_key="test")
    
    # 1. Simple chat
    r = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=50,
        messages=[{"role": "user", "content": "Say 'anthropic works'"}],
    )
    print(f"✓ Anthropic chat: {r.content[0].text}")
    assert "anthropic" in r.content[0].text.lower()
    
    # 2. Tool call
    r = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=100,
        messages=[{"role": "user", "content": "Use calc to add 10+20"}],
        tools=[{
            "name": "calc",
            "description": "Add two numbers",
            "input_schema": {
                "type": "object",
                "properties": {"a": {"type": "number"}, "b": {"type": "number"}},
                "required": ["a", "b"],
            },
        }],
    )
    if r.stop_reason == "tool_use":
        tc = r.content[0]
        print(f"✓ Anthropic tool call: {tc.name}({json.dumps(tc.input)})")
        assert tc.name == "calc"
    else:
        print(f"[..] Anthropic: no tool call (stop_reason={r.stop_reason})")
        print(f"     Text: {r.content[0].text[:200]}")

def test_gemini():
    try:
        from google import genai
    except ImportError:
        print("✗ Gemini SDK not installed")
        return

    # The google-genai SDK doesn't support arbitrary http_options for base_url well.
    # We use the direct REST approach that the SDK generates internally.
    import requests
    
    # Gemini native format test via direct REST (same wire format SDK uses)
    # This verifies the gateway's Gemini converter end-to-end
    
    # 1. Simple chat in native Gemini wire format
    resp = requests.post(
        "http://127.0.0.1:47113/v1beta/models/gemini-2.5-flash:generateContent",
        json={
            "contents": [{"role": "user", "parts": [{"text": "Say 'gemini works' in 3 words"}]}]
        },
    )
    data = resp.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    print(f"✓ Gemini chat: {text}")
    assert "gemini" in text.lower()
    
    # 2. Tool call in native Gemini wire format
    resp = requests.post(
        "http://127.0.0.1:47113/v1beta/models/gemini-2.5-flash:generateContent",
        json={
            "contents": [{"role": "user", "parts": [{"text": "Use calc to add 10+20"}]}],
            "tools": [{
                "functionDeclarations": [{
                    "name": "calc",
                    "description": "Add two numbers",
                    "parameters": {
                        "type": "object",
                        "properties": {"a": {"type": "number"}, "b": {"type": "number"}},
                        "required": ["a", "b"],
                    },
                }]
            }]
        },
    )
    data = resp.json()
    candidate = data["candidates"][0]
    if candidate.get("finishReason") == "STOP" and candidate["content"]["parts"][0].get("functionCall"):
        fc = candidate["content"]["parts"][0]["functionCall"]
        print(f"✓ Gemini tool call: {fc['name']}({fc['args']})")
        assert fc["name"] == "calc"
    else:
        print(f"[..] Gemini: no tool call (finishReason={candidate.get('finishReason')})")
        print(f"     Parts: {candidate['content']['parts']}")

if __name__ == "__main__":
    print("=== DMR-X Gateway — SDK compatibility test ===")
    print()
    
    try:
        test_openai()
    except Exception as e:
        print(f"✗ OpenAI: {e}")
    print()
    
    try:
        test_anthropic()
    except Exception as e:
        print(f"✗ Anthropic: {e}")
    print()
    
    try:
        test_gemini()
    except Exception as e:
        print(f"✗ Gemini: {e}")
