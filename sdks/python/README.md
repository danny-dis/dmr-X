# DMR-X Python SDK

[![PyPI version](https://img.shields.io/pypi/v/dmrx.svg)](https://pypi.org/project/dmrx/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Python SDK for [DMR-X](https://dmr-x.io) — the universal AI routing and orchestration platform.

## Installation

```bash
pip install dmrx
```

## Quick Start

```python
from dmrx import DMRXClient

client = DMRXClient(
    api_key="dmrx_...",
    base_url="http://localhost:3000",  # your DMR-X gateway URL
)

# Chat completion with meta-model alias
response = client.chat.completions.create(
    model="auto-coding",
    messages=[{"role": "user", "content": "Write a Python function to sort a list"}],
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Write a short poem"}],
    stream=True,
)
for chunk in stream:
    if chunk.type == "token":
        print(chunk.data.get("content", ""), end="")
```

## Async Usage

```python
import asyncio
from dmrx import AsyncDMRXClient

async def main():
    client = AsyncDMRXClient(api_key="dmrx_...")
    response = await client.chat.completions.create(
        model="auto-smart",
        messages=[{"role": "user", "content": "What is the meaning of life?"}],
    )
    print(response.choices[0].message.content)
    await client.close()

asyncio.run(main())
```

## Features

- **Drop-in OpenAI SDK replacement** — same method signatures
- **Sync + Async** — `DMRXClient` (sync) and `AsyncDMRXClient` (async)
- **Streaming** — SSE-based streaming with `Stream` and `AsyncStream` iterators
- **Meta-model aliases** — `auto`, `auto-fast`, `auto-smart`, `auto-agentic`, `auto-coding`
- **Multi-modal** — chat, images, embeddings, audio, video
- **Type-safe** — fully typed with Pydantic v2 models
- **Error hierarchy** — typed exceptions for every DMR-X error code

## API Reference

### Chat

```python
# Sync
response = client.chat.completions.create(
    model="auto-coding",
    messages=[{"role": "user", "content": "Hello"}],
    temperature=0.7,
    max_tokens=1024,
    stream=False,
)

# Streaming
stream = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
)
for chunk in stream:
    if chunk.type == "token":
        print(chunk.data["content"], end="")
```

### Models

```python
# List all models
models = client.models.list()
for model in models.data:
    print(f"{model.id} (owned by {model.owned_by})")

# Get a specific model
model = client.models.retrieve("gpt-4o")
```

### Embeddings

```python
response = client.embeddings.create(
    input=["Hello world", "How are you?"],
    model="auto",
)
for data in response.data:
    print(f"Index {data.index}: {len(data.embedding)} dimensions")
```

### Images

```python
response = client.images.generate(
    prompt="A beautiful sunset over mountains",
    model="auto",
    size="1024x1024",
    n=1,
)
print(response.data[0].url)
```

### Audio

```python
# Text-to-Speech
response = client.audio.speech(
    input="Hello, welcome to DMR-X!",
    voice="alloy",
    model="auto",
)
with open("output.mp3", "wb") as f:
    f.write(response.data)

# Speech-to-Text
response = client.audio.transcriptions(
    audio="base64_encoded_audio_string",
    model="auto",
)
print(response.text)
```

## DMR-X Routing Parameters

The Python SDK supports all DMR-X-specific routing parameters:

```python
response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Hello"}],
    quality="frontier",              # frontier, balanced, economy
    provider_preference=["openai"],  # preferred providers
    provider_blacklist=["groq"],     # providers to exclude
    latency_target="500ms",          # max acceptable latency
    cost_target=0.50,                # max cost per 1M output tokens
    local_first=True,                # prefer local models
    require_privacy=True,            # privacy-preserving providers only
)
```

## Error Handling

```python
from dmrx import (
    DMRXError,
    AuthenticationError,
    RateLimitError,
    QuotaExhaustedError,
    ProviderUnavailableError,
)

try:
    response = client.chat.completions.create(...)
except AuthenticationError:
    print("Check your API key")
except RateLimitError:
    print("Too many requests — slow down")
except QuotaExhaustedError:
    print("No quota remaining")
except ProviderUnavailableError:
    print("All providers are unavailable — retry later")
except DMRXError as e:
    print(f"DMR-X error [{e.code}]: {e}")
```

## Type Definitions

The canonical TypeScript type definitions for DMR-X are published under MIT
license in the `packages/types/` directory — see
[`@dmr-x/types`](https://github.com/dmr-x/dmr-x/tree/main/packages/types).
All SDK types are derived from these definitions, which serve as the
single source of truth for the DMR-X public API contract.

## License

MIT — same as the DMR-X core SDK packages. The DMR-X platform itself is licensed under GPL-2.0.
