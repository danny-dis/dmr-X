"""Test all 3 native SDKs against DMR-X gateway."""
import json
import sys

def test_openai():
    from openai import OpenAI
    client = OpenAI(base_url="http://127.0.0.1:47113/v1", api_key="test")
    
    # Test 1: simple chat
    r = client.chat.completions.create(
        model="openrouter-free/deepseek/deepseek-chat",
        messages=[{"role": "user", "content": "Say 'openai works' in one sentence"}],
        max_tokens=50,
    )
    print(f"[OK] OpenAI: {r.choices[0].message.content}")
    
    # Test 2: tool call
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
        print(f"[OK] OpenAI tools: {calls[0].function.name}({calls[0].function.arguments})")
    else:
        print(f"[..] OpenAI tools: model replied with text (no tool call)")
        print(f"     Text: {r.choices[0].message.content}")

def test_anthropic():
    try:
        from anthropic import Anthropic
    except ImportError:
        print("[SKIP] Anthropic SDK not installed")
        return
    
    client = Anthropic(base_url="http://127.0.0.1:47113", api_key="test")
    r = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=50,
        messages=[{"role": "user", "content": "Say 'anthropic works'"}],
    )
    print(f"[OK] Anthropic: {r.content[0].text[:100]}")

def test_gemini():
    try:
        from google import genai
    except ImportError:
        print("[SKIP] Gemini SDK not installed")
        return

    client = genai.Client(
        api_key="test",
        http_options={"api_version": "v1beta", "base_url": "http://127.0.0.1:47113"},
    )
    try:
        r = client.models.generate_content(
            model="gemini-2.5-flash",
            contents="Say 'gemini works' in 3 words",
        )
        print(f"[OK] Gemini: {r.text[:100]}")
    except Exception as e:
        print(f"[FAIL] Gemini: {e}")

if __name__ == "__main__":
    print("=== Testing DMR-X Gateway ===")
    try:
        test_openai()
    except Exception as e:
        print(f"[FAIL] OpenAI: {e}")
    try:
        test_anthropic()
    except Exception as e:
        print(f"[FAIL] Anthropic: {e}")
    try:
        test_gemini()
    except Exception as e:
        print(f"[FAIL] Gemini: {e}")
