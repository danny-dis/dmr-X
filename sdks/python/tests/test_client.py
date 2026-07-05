"""Tests for the DMR-X Python SDK."""

import json
from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest

from dmrx import DMRXClient
from dmrx.errors import (
    AuthenticationError,
    DMRXError,
    ProviderError,
    RateLimitError,
)
from dmrx.types.chat import ChatCompletionResponse
from dmrx.types.models import Model, ModelList
from dmrx.types.shared import TokenUsage


def make_mock_response(status_code=200, json_data=None):
    """Create a mock httpx response."""
    response = Mock(spec=httpx.Response)
    response.status_code = status_code
    response.is_success = status_code < 400
    response.json.return_value = json_data or {}
    return response


class TestDMRXClient:
    """Test suite for DMRXClient."""

    def setup_method(self):
        self.client = DMRXClient(api_key="test-key", base_url="http://localhost:3000")

    def test_chat_completion(self):
        """Test a basic chat completion request."""
        mock_resp = {
            "id": "chatcmpl-123",
            "object": "chat.completion",
            "created": 1000000,
            "model": "gpt-4o",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Hello, world!",
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20,
                "total_tokens": 30,
            },
        }

        self.client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        response = self.client.chat.completions.create(
            model="auto-coding",
            messages=[{"role": "user", "content": "Hello!"}],
        )

        assert isinstance(response, ChatCompletionResponse)
        assert response.id == "chatcmpl-123"
        assert len(response.choices) == 1
        assert response.choices[0].message.content == "Hello, world!"
        assert response.usage.prompt_tokens == 10

    def test_chat_completion_with_routing_params(self):
        """Test chat completion with DMR-X specific routing parameters."""
        mock_resp = {
            "id": "chatcmpl-456",
            "object": "chat.completion",
            "created": 1000000,
            "model": "claude-sonnet-4-0520",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Response"},
                    "finish_reason": "stop",
                }
            ],
            "provider": "anthropic",
            "latency_ms": 450.0,
        }

        self.client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        response = self.client.chat.completions.create(
            model="auto-smart",
            messages=[{"role": "user", "content": "Hello"}],
            quality="frontier",
            provider_preference=["anthropic"],
            latency_target="500ms",
            local_first=False,
        )

        assert response.provider == "anthropic"
        assert response.latency_ms == 450.0

    def test_list_models(self):
        """Test listing available models."""
        mock_resp = {
            "object": "list",
            "data": [
                {
                    "id": "gpt-4o",
                    "object": "model",
                    "created": 1000000,
                    "owned_by": "openai",
                },
                {
                    "id": "claude-sonnet-4-0520",
                    "object": "model",
                    "created": 1000000,
                    "owned_by": "anthropic",
                },
            ],
        }

        self.client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        models = self.client.models.list()

        assert isinstance(models, ModelList)
        assert len(models.data) == 2
        assert models.data[0].id == "gpt-4o"
        assert models.data[1].owned_by == "anthropic"

    def test_retrieve_model(self):
        """Test retrieving a single model."""
        mock_resp = {
            "id": "gpt-4o",
            "object": "model",
            "created": 1000000,
            "owned_by": "openai",
        }

        self.client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        model = self.client.models.retrieve("gpt-4o")

        assert isinstance(model, Model)
        assert model.id == "gpt-4o"
        assert model.owned_by == "openai"

    def test_authentication_error(self):
        """Test that auth errors raise the correct exception."""
        error_resp = {"code": "AUTHENTICATION_ERROR", "message": "Invalid API key"}
        self.client._transport.request = Mock(
            side_effect=AuthenticationError("Invalid API key")
        )

        with pytest.raises(AuthenticationError) as exc_info:
            self.client.chat.completions.create(
                model="auto",
                messages=[{"role": "user", "content": "Hello"}],
            )

        assert exc_info.value.status_code == 401
        assert "Invalid API key" in str(exc_info.value)

    def test_rate_limit_error(self):
        """Test that rate limit errors raise the correct exception."""
        self.client._transport.request = Mock(
            side_effect=RateLimitError(retry_after_ms=2000)
        )

        with pytest.raises(RateLimitError) as exc_info:
            self.client.chat.completions.create(
                model="auto",
                messages=[{"role": "user", "content": "Hello"}],
            )

        assert exc_info.value.status_code == 429
        assert exc_info.value.details.get("retry_after_ms") == 2000

    def test_provider_error(self):
        """Test that provider errors raise the correct exception."""
        self.client._transport.request = Mock(
            side_effect=ProviderError("Upstream timeout", provider_id="openai")
        )

        with pytest.raises(ProviderError) as exc_info:
            self.client.chat.completions.create(
                model="auto",
                messages=[{"role": "user", "content": "Hello"}],
            )

        assert exc_info.value.provider_id == "openai"
        assert exc_info.value.is_retryable is True

    def test_embeddings(self):
        """Test creating embeddings."""
        mock_resp = {
            "object": "list",
            "data": [
                {
                    "index": 0,
                    "embedding": [0.1, 0.2, 0.3],
                    "object": "embedding",
                }
            ],
            "model": "text-embedding-3-small",
            "usage": {"prompt_tokens": 5, "total_tokens": 5},
        }

        self.client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        response = self.client.embeddings.create(
            input=["Hello world"],
            model="auto",
        )

        assert len(response.data) == 1
        assert response.data[0].index == 0
        assert len(response.data[0].embedding) == 3
        assert response.usage.prompt_tokens == 5

    def test_image_generation(self):
        """Test image generation."""
        mock_resp = {
            "created": 1000000,
            "data": [
                {
                    "url": "https://example.com/image.png",
                    "revised_prompt": "A beautiful sunset",
                }
            ],
        }

        self.client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        response = self.client.images.generate(
            prompt="A beautiful sunset",
            model="auto",
            size="1024x1024",
        )

        assert len(response.data) == 1
        assert response.data[0].url == "https://example.com/image.png"
        assert response.data[0].revised_prompt == "A beautiful sunset"

    def test_meta_model_aliases_work_natively(self):
        """Verify all meta-model aliases are accepted."""
        self.client._transport.request = Mock(return_value=make_mock_response(json_data={
            "id": "test",
            "object": "chat.completion",
            "created": 1000000,
            "model": "gpt-4o",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "OK"}}],
        }))

        for alias in ["auto", "auto-fast", "auto-smart", "auto-agentic", "auto-coding"]:
            response = self.client.chat.completions.create(
                model=alias,
                messages=[{"role": "user", "content": "Hello"}],
            )
            assert response.choices[0].message.content == "OK"

    def test_streaming_request(self):
        """Test that stream=True returns a Stream object."""
        self.client._transport.stream_lines = Mock(return_value=iter([
            'data: {"type":"token","data":{"content":"Hello"},"index":0}\n',
            'data: {"type":"token","data":{"content":" world"},"index":1}\n',
            'data: {"type":"done","data":{"requestId":"123","finishReason":"stop"},"index":2}\n',
        ]))

        stream = self.client.chat.completions.create(
            model="auto",
            messages=[{"role": "user", "content": "Hello"}],
            stream=True,
        )

        chunks = list(stream)
        assert len(chunks) == 3
        assert chunks[0].data["content"] == "Hello"
        assert chunks[2].type == "done"

    def test_video_generation(self):
        """Test video generation."""
        mock_resp = {
            "created": 1000000,
            "data": [
                {
                    "url": "https://example.com/video.mp4",
                    "duration": 10.0,
                    "fps": 24,
                }
            ],
        }

        self.client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        response = self.client.videos.generate(
            prompt="A beautiful landscape",
            model="auto",
            duration=10,
        )

        assert len(response.data) == 1
        assert response.data[0].url == "https://example.com/video.mp4"
        assert response.data[0].duration == 10.0
        assert response.data[0].fps == 24

    def test_audio_speech(self):
        """Test text-to-speech."""
        self.client._transport.request = Mock(
            return_value=make_mock_response(
                json_data={"content_type": "audio/mpeg"},
            )
        )
        self.client._transport.request.return_value.content = b"fake_audio_data"
        self.client._transport.request.return_value.headers = {"content-type": "audio/mpeg"}

        response = self.client.audio.speech(
            input="Hello world",
            voice="alloy",
            model="auto",
        )

        assert response.data == b"fake_audio_data"
        assert response.content_type == "audio/mpeg"

    def test_audio_transcription(self):
        """Test speech-to-text."""
        mock_resp = {
            "text": "Hello world",
            "language": "en",
            "duration": 2.5,
        }

        self.client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        response = self.client.audio.transcriptions(
            audio="base64_audio_data",
            model="auto",
        )

        assert response.text == "Hello world"
        assert response.language == "en"
        assert response.duration == 2.5


class TestStreaming:
    """Tests for SSE streaming parsing."""

    def test_native_token_chunk(self):
        """Parse a DMR-X native token chunk."""
        from dmrx.streaming import parse_sse_event
        chunk = parse_sse_event('{"type":"token","data":{"content":"Hello"},"index":0}')
        assert chunk is not None
        assert chunk.type == "token"
        assert chunk.data["content"] == "Hello"
        assert chunk.index == 0

    def test_native_done_chunk(self):
        """Parse a DMR-X native done chunk."""
        from dmrx.streaming import parse_sse_event
        chunk = parse_sse_event(
            '{"type":"done","data":{"requestId":"req-1","modelId":"gpt-4o","finishReason":"stop"}, "index":1}'
        )
        assert chunk is not None
        assert chunk.type == "done"
        assert chunk.data["requestId"] == "req-1"
        assert chunk.data["finishReason"] == "stop"

    def test_native_error_chunk(self):
        """Parse a DMR-X native error chunk."""
        from dmrx.streaming import parse_sse_event
        chunk = parse_sse_event(
            '{"type":"error","data":{"code":"PROVIDER_ERROR","message":"Upstream failed"},"index":2}'
        )
        assert chunk is not None
        assert chunk.type == "error"
        assert chunk.data["code"] == "PROVIDER_ERROR"

    def test_openai_streaming_format(self):
        """Parse an OpenAI-compatible streaming chunk."""
        from dmrx.streaming import parse_sse_event
        chunk = parse_sse_event(
            '{"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}'
        )
        assert chunk is not None
        assert chunk.type == "token"
        assert chunk.data["content"] == "Hello"

    def test_openai_done_format(self):
        """Parse an OpenAI-compatible done chunk with finish_reason."""
        from dmrx.streaming import parse_sse_event
        chunk = parse_sse_event(
            '{"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":"stop"}]}'
        )
        assert chunk is not None
        assert chunk.type == "done"
        assert chunk.data["finishReason"] == "stop"

    def test_openai_streaming_tool_call(self):
        """Parse an OpenAI streaming chunk with a tool call delta."""
        from dmrx.streaming import parse_sse_event
        chunk = parse_sse_event(
            '{"id":"chatcmpl-456","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}}]}}]}'
        )
        assert chunk is not None
        assert chunk.type == "token"
        assert len(chunk.data["tool_calls"]) > 0
        assert chunk.data["tool_calls"][0]["function"]["name"] == "get_weather"

    def test_sse_stream_full_cycle(self):
        """Test a full SSE stream from raw lines to parsed chunks."""
        from dmrx.streaming import Stream

        lines = iter([
            'data: {"type":"token","data":{"content":"Hello"},"index":0}\n',
            'data: {"type":"token","data":{"content":" world"},"index":1}\n',
            'data: {"type":"done","data":{"requestId":"req-xyz","modelId":"gpt-4o","finishReason":"stop","usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}},"index":2}\n',
        ])

        stream = Stream(lines)
        chunks = list(stream)

        assert len(chunks) == 3
        assert chunks[0].type == "token"
        assert chunks[0].data["content"] == "Hello"
        assert chunks[1].data["content"] == " world"
        assert chunks[2].type == "done"
        assert chunks[2].data["finishReason"] == "stop"

    def test_openai_done_marker(self):
        """Test the [DONE] terminator in OpenAI SSE format."""
        from dmrx.streaming import Stream

        lines = iter([
            'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n',
            '\n',
            'data: [DONE]\n',
        ])

        stream = Stream(lines)
        chunks = list(stream)
        assert len(chunks) == 1
        assert chunks[0].type == "token"
        assert chunks[0].data["content"] == "Hello"

    def test_anthropic_style_events_skipped(self):
        """Anthropic event: fields should be skipped, only data: is parsed."""
        from dmrx.streaming import Stream

        lines = iter([
            'event: content_block_delta\n',
            'data: {"type":"token","data":{"content":"Hello"},"index":0}\n',
            '\n',
            'event: message_stop\n',
            'data: {"type":"done","data":{"finishReason":"stop"},"index":1}\n',
        ])

        stream = Stream(lines)
        chunks = list(stream)
        assert len(chunks) == 2


class TestAsyncDMRXClient:
    """Tests for the async client."""

    @pytest.mark.asyncio
    async def test_async_client_init_and_close(self):
        """Async client can be initialized and closed."""
        from dmrx import AsyncDMRXClient
        client = AsyncDMRXClient(api_key="test-key", base_url="http://localhost:3000")
        await client.close()
        # No exception means success

    @pytest.mark.asyncio
    async def test_async_chat_completion(self):
        """Test async chat completion."""
        from dmrx import AsyncDMRXClient

        client = AsyncDMRXClient(api_key="test-key", base_url="http://localhost:3000")

        mock_resp = {
            "id": "chatcmpl-async",
            "object": "chat.completion",
            "created": 2000000,
            "model": "gpt-4o",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Async response"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 5, "completion_tokens": 10, "total_tokens": 15},
        }

        client._transport.async_request = AsyncMock()
        client._transport.async_request.return_value = make_mock_response(json_data=mock_resp)

        response = await client.chat.completions.create(
            model="auto",
            messages=[{"role": "user", "content": "Hello async"}],
        )

        assert response.id == "chatcmpl-async"
        assert response.choices[0].message.content == "Async response"
        await client.close()
