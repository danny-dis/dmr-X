"""Tests for the DMR-X SDK observability callback system."""

import json
import os
from unittest.mock import Mock, patch

import httpx
import pytest

from dmrx import DMRXClient, AsyncDMRXClient
from dmrx.callbacks import DMRXCallback, CallbackManager


# ── Mock Callback for Testing ──────────────────────────────────────


class RecordingCallback(DMRXCallback):
    """Records all callback events for assertions."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    def _record(self, name: str, **kwargs) -> None:
        self.events.append({"name": name, **kwargs})

    def on_request_start(self, endpoint, body):
        self._record("on_request_start", endpoint=endpoint, body=body)

    def on_request_end(self, endpoint, body, response, duration_ms):
        self._record(
            "on_request_end",
            endpoint=endpoint,
            body=body,
            response=response,
            duration_ms=duration_ms,
        )

    def on_request_error(self, endpoint, body, error, duration_ms):
        self._record(
            "on_request_error",
            endpoint=endpoint,
            body=body,
            error=error,
            duration_ms=duration_ms,
        )

    def on_stream_start(self, endpoint, body):
        self._record("on_stream_start", endpoint=endpoint, body=body)

    def on_stream_chunk(self, endpoint, body, chunk):
        self._record(
            "on_stream_chunk", endpoint=endpoint, body=body, chunk=chunk
        )

    def on_stream_end(self, endpoint, body, final_data, duration_ms):
        self._record(
            "on_stream_end",
            endpoint=endpoint,
            body=body,
            final_data=final_data,
            duration_ms=duration_ms,
        )

    def on_stream_error(self, endpoint, body, error, duration_ms):
        self._record(
            "on_stream_error",
            endpoint=endpoint,
            body=body,
            error=error,
            duration_ms=duration_ms,
        )


# ── Fixtures ───────────────────────────────────────────────────────


def make_mock_response(status_code=200, json_data=None):
    """Create a mock httpx response."""
    response = Mock(spec=httpx.Response)
    response.status_code = status_code
    response.is_success = status_code < 400
    response.json.return_value = json_data or {}
    response.headers = {"content-type": "application/json"}
    response.content = b"audio_data"
    return response


@pytest.fixture
def callback():
    return RecordingCallback()


@pytest.fixture
def client(callback):
    return DMRXClient(
        api_key="test-key",
        base_url="http://localhost:3000",
        observe=callback,
    )


@pytest.fixture
def async_client(callback):
    return AsyncDMRXClient(
        api_key="test-key",
        base_url="http://localhost:3000",
        observe=callback,
    )


# ── Test: DMRXCallback Base Class ──────────────────────────────────


class TestDMRXCallback:
    """DMRXCallback base class methods are all no-ops by default."""

    def test_base_class_is_abstract(self):
        """DMRXCallback can be instantiated (all methods have default impls)."""
        cb = DMRXCallback()
        # These should not raise
        cb.on_request_start("test", {})
        cb.on_request_end("test", {}, {}, 0.0)
        cb.on_request_error("test", {}, Exception("x"), 0.0)
        cb.on_stream_start("test", {})
        cb.on_stream_chunk("test", {}, {})
        cb.on_stream_end("test", {}, {}, 0.0)
        cb.on_stream_error("test", {}, Exception("x"), 0.0)


# ── Test: CallbackManager ──────────────────────────────────────────


class TestCallbackManager:
    """CallbackManager normalisation and dispatch."""

    def test_empty_manager_no_errors(self):
        """CallbackManager with no callbacks should silently no-op."""
        mgr = CallbackManager()
        mgr.on_request_start("test", {})
        mgr.on_request_end("test", {}, {}, 0.0)
        mgr.on_stream_chunk("test", {}, {})

    def test_single_callback(self):
        """A single callback instance receives all events."""
        cb = RecordingCallback()
        mgr = CallbackManager(cb)
        mgr.on_request_start("chat", {"model": "auto"})
        assert len(cb.events) == 1
        assert cb.events[0]["name"] == "on_request_start"

    def test_multiple_callbacks(self):
        """Multiple callbacks all receive the same events."""
        cb1 = RecordingCallback()
        cb2 = RecordingCallback()
        mgr = CallbackManager([cb1, cb2])
        mgr.on_request_end("chat", {}, {}, 42.0)
        assert len(cb1.events) == 1
        assert len(cb2.events) == 1

    def test_from_string_langfuse_without_dep(self):
        """String 'langfuse' without the package raises ImportError."""
        with pytest.raises(ImportError, match="langfuse"):
            CallbackManager("langfuse")

    def test_from_string_mlflow_without_dep(self):
        """String 'mlflow' without the package raises ImportError."""
        with pytest.raises(ImportError, match="MLflow"):
            CallbackManager("mlflow")

    def test_from_string_unknown(self):
        """Unknown backend string raises ValueError."""
        with pytest.raises(ValueError, match="Unknown observability backend"):
            CallbackManager("unknown_backend")

    def test_from_true_without_env(self):
        """True without DMRX_OBSERVABILITY_BACKEND env var -> empty."""
        mgr = CallbackManager(True)
        assert mgr.callbacks == []

    @patch.dict(os.environ, {"DMRX_OBSERVABILITY_BACKEND": "langfuse"}, clear=True)
    def test_from_true_with_env(self):
        """True with DMRX_OBSERVABILITY_BACKEND=langfuse triggers auto-create."""
        with pytest.raises(ImportError, match="langfuse"):
            CallbackManager(True)

    def test_bool_false(self):
        """False behaves like None."""
        mgr = CallbackManager(False)
        assert mgr.callbacks == []

    def test_bool_truthy(self):
        """Callbacks list is truthy if non-empty."""
        cb = RecordingCallback()
        mgr = CallbackManager(cb)
        assert bool(mgr) is True

    def test_bool_falsy(self):
        """Empty manager is falsy."""
        mgr = CallbackManager()
        assert bool(mgr) is False


# ── Test: Instrumented Chat Completions (Non-streaming) ────────────


class TestInstrumentedChat:
    """Chat completion with callbacks."""

    def test_chat_start_and_end_events(self, client, callback):
        """Non-streaming chat fires on_request_start then on_request_end."""
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
                        "content": "Hello!",
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        }
        client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        response = client.chat.completions.create(
            model="auto-coding",
            messages=[{"role": "user", "content": "Hi"}],
        )

        assert response.choices[0].message.content == "Hello!"

        # Check events
        names = [e["name"] for e in callback.events]
        assert names == ["on_request_start", "on_request_end"]
        assert callback.events[0]["endpoint"] == "chat.completions"
        assert callback.events[0]["body"]["model"] == "auto-coding"
        assert callback.events[1]["response"]["id"] == "chatcmpl-123"
        assert callback.events[1]["duration_ms"] >= 0

    def test_chat_error_event(self, client, callback):
        """On HTTP error, on_request_error is fired."""
        client._transport.request = Mock(
            side_effect=Exception("Connection refused")
        )

        with pytest.raises(Exception, match="Connection refused"):
            client.chat.completions.create(
                model="auto",
                messages=[{"role": "user", "content": "Hi"}],
            )

        names = [e["name"] for e in callback.events]
        assert "on_request_error" in names
        error_event = [e for e in callback.events if e["name"] == "on_request_error"][0]
        assert error_event["endpoint"] == "chat.completions"
        assert "Connection refused" in str(error_event["error"])


# ── Test: Streaming + Callbacks ────────────────────────────────────


class TestInstrumentedStreaming:
    """Streaming chat with callbacks."""

    def test_stream_start_chunk_end_events(self, client, callback):
        """Streaming fires on_stream_start, on_stream_chunk(s), on_stream_end."""
        client._transport.stream_lines = Mock(return_value=iter([
            'data: {"type":"token","data":{"content":"Hello"},"index":0}\n',
            'data: {"type":"token","data":{"content":" world"},"index":1}\n',
            'data: {"type":"done","data":{"requestId":"req-1","modelId":"gpt-4o","finishReason":"stop","usage":{"prompt_tokens":5,"completion_tokens":10,"total_tokens":15}},"index":2}\n',
        ]))

        stream = client.chat.completions.create(
            model="auto",
            messages=[{"role": "user", "content": "Hi"}],
            stream=True,
        )

        chunks = list(stream)

        # Check we got the expected chunks
        assert len(chunks) == 3
        assert chunks[0].data["content"] == "Hello"
        assert chunks[2].type == "done"

        # Check callback events
        names = [e["name"] for e in callback.events]
        assert names == [
            "on_stream_start",
            "on_stream_chunk",
            "on_stream_chunk",
            "on_stream_end",
        ]

        assert callback.events[0]["endpoint"] == "chat.completions"
        assert callback.events[0]["body"]["model"] == "auto"
        assert callback.events[1]["chunk"]["type"] == "token"
        assert callback.events[3]["final_data"]["requestId"] == "req-1"
        assert callback.events[3]["duration_ms"] >= 0

    def test_stream_openai_format(self, client, callback):
        """OpenAI-compatible streaming also fires correct events."""
        client._transport.stream_lines = Mock(return_value=iter([
            'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n',
            'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":"stop"}]}\n',
        ]))

        stream = client.chat.completions.create(
            model="auto",
            messages=[{"role": "user", "content": "Hi"}],
            stream=True,
        )

        chunks = list(stream)
        assert len(chunks) == 2

        names = [e["name"] for e in callback.events]
        assert "on_stream_start" in names
        assert "on_stream_chunk" in names
        assert "on_stream_end" in names

    def test_stream_done_marker(self, client, callback):
        """[DONE] marker fires on_stream_end."""
        client._transport.stream_lines = Mock(return_value=iter([
            'data: {"type":"token","data":{"content":"Hi"},"index":0}\n',
            'data: [DONE]\n',
        ]))

        stream = client.chat.completions.create(
            model="auto",
            messages=[{"role": "user", "content": "Hi"}],
            stream=True,
        )

        list(stream)

        names = [e["name"] for e in callback.events]
        assert "on_stream_end" in names
        assert names[-1] == "on_stream_end"

    def test_stream_error_chunk(self, client, callback):
        """Error chunk fires on_stream_error."""
        client._transport.stream_lines = Mock(return_value=iter([
            'data: {"type":"error","data":{"code":"PROVIDER_ERROR","message":"Upstream failed"},"index":0}\n',
        ]))

        stream = client.chat.completions.create(
            model="auto",
            messages=[{"role": "user", "content": "Hi"}],
            stream=True,
        )

        chunks = list(stream)
        assert len(chunks) == 1
        assert chunks[0].type == "error"

        names = [e["name"] for e in callback.events]
        assert "on_stream_error" in names


# ── Test: Instrumented Embeddings ──────────────────────────────────


class TestInstrumentedEmbeddings:
    """Embeddings with callbacks."""

    def test_embeddings_events(self, client, callback):
        """Embeddings fires on_request_start and on_request_end."""
        mock_resp = {
            "object": "list",
            "data": [{"index": 0, "embedding": [0.1, 0.2], "object": "embedding"}],
            "model": "text-embedding-3-small",
            "usage": {"prompt_tokens": 5, "total_tokens": 5},
        }
        client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        response = client.embeddings.create(input=["Hello"], model="auto")

        assert len(response.data) == 1
        names = [e["name"] for e in callback.events]
        assert names == ["on_request_start", "on_request_end"]
        assert callback.events[0]["endpoint"] == "embeddings"


# ── Test: Instrumented Images ──────────────────────────────────────


class TestInstrumentedImages:
    """Image generation with callbacks."""

    def test_image_events(self, client, callback):
        """Image generation fires on_request_start and on_request_end."""
        mock_resp = {
            "created": 1000000,
            "data": [{"url": "https://example.com/img.png"}],
        }
        client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        response = client.images.generate(prompt="A cat", model="auto")

        assert len(response.data) == 1
        names = [e["name"] for e in callback.events]
        assert names == ["on_request_start", "on_request_end"]


# ── Test: Instrumented Videos ──────────────────────────────────────


class TestInstrumentedVideos:
    """Video generation with callbacks."""

    def test_video_events(self, client, callback):
        """Video generation fires on_request_start and on_request_end."""
        mock_resp = {
            "created": 1000000,
            "data": [{"url": "https://example.com/vid.mp4", "duration": 10.0, "fps": 24}],
        }
        client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        response = client.videos.generate(prompt="A landscape", model="auto")

        assert len(response.data) == 1
        names = [e["name"] for e in callback.events]
        assert names == ["on_request_start", "on_request_end"]


# ── Test: Instrumented Audio ───────────────────────────────────────


class TestInstrumentedAudio:
    """Audio endpoints with callbacks."""

    def test_audio_speech_events(self, client, callback):
        """Audio TTS fires on_request_start and on_request_end."""
        mock_resp = make_mock_response(json_data={})
        mock_resp.headers = {"content-type": "audio/mpeg"}
        mock_resp.content = b"fake_audio"
        client._transport.request = Mock(return_value=mock_resp)

        response = client.audio.speech(input="Hello", voice="alloy", model="auto")

        assert response.data == b"fake_audio"
        names = [e["name"] for e in callback.events]
        assert names == ["on_request_start", "on_request_end"]
        # Metadata response should include content_type and size_bytes
        resp_data = callback.events[1]["response"]
        assert resp_data["content_type"] == "audio/mpeg"
        assert resp_data["size_bytes"] == 10

    def test_audio_speech_error(self, client, callback):
        """Audio TTS error fires on_request_error."""
        client._transport.request = Mock(
            side_effect=Exception("Audio service unavailable")
        )

        with pytest.raises(Exception, match="Audio service unavailable"):
            client.audio.speech(input="Hello", voice="alloy", model="auto")

        names = [e["name"] for e in callback.events]
        assert "on_request_error" in names
        assert callback.events[0]["endpoint"] == "audio.speech"

    def test_audio_transcription_events(self, client, callback):
        """Audio STT fires on_request_start and on_request_end."""
        mock_resp = {
            "text": "Hello world",
            "language": "en",
            "duration": 2.5,
        }
        client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        response = client.audio.transcriptions(audio="base64data", model="auto")

        assert response.text == "Hello world"
        names = [e["name"] for e in callback.events]
        assert names == ["on_request_start", "on_request_end"]


# ── Test: Instrumented Models ──────────────────────────────────────


class TestInstrumentedModels:
    """Model endpoints with callbacks."""

    def test_list_models_events(self, client, callback):
        """List models fires on_request_start and on_request_end."""
        mock_resp = {
            "object": "list",
            "data": [
                {"id": "gpt-4o", "object": "model", "created": 1000000, "owned_by": "openai"},
            ],
        }
        client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        models = client.models.list()
        assert len(models.data) == 1
        names = [e["name"] for e in callback.events]
        assert names == ["on_request_start", "on_request_end"]
        assert callback.events[0]["endpoint"] == "models.list"

    def test_retrieve_model_events(self, client, callback):
        """Retrieve model fires on_request_start and on_request_end."""
        mock_resp = {
            "id": "gpt-4o",
            "object": "model",
            "created": 1000000,
            "owned_by": "openai",
        }
        client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        model = client.models.retrieve("gpt-4o")
        assert model.id == "gpt-4o"
        names = [e["name"] for e in callback.events]
        assert names == ["on_request_start", "on_request_end"]
        assert callback.events[0]["endpoint"] == "models.retrieve"


# ── Test: Multiple Callbacks ───────────────────────────────────────


class TestMultipleCallbacks:
    """Multiple callbacks all receive events."""

    def test_two_callbacks_receive_same_events(self):
        """Two RecordingCallbacks both see the same chat events."""
        cb1 = RecordingCallback()
        cb2 = RecordingCallback()

        client = DMRXClient(
            api_key="test-key",
            base_url="http://localhost:3000",
            observe=[cb1, cb2],
        )

        mock_resp = {
            "id": "chatcmpl-multi",
            "object": "chat.completion",
            "created": 1000000,
            "model": "gpt-4o",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hi"},
                    "finish_reason": "stop",
                }
            ],
        }
        client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        client.chat.completions.create(
            model="auto",
            messages=[{"role": "user", "content": "Hello"}],
        )

        assert len(cb1.events) == 2
        assert len(cb2.events) == 2
        assert cb1.events[0]["name"] == cb2.events[0]["name"]
        assert cb1.events[0]["endpoint"] == "chat.completions"


# ── Test: Async Client with Callbacks ──────────────────────────────


class TestAsyncInstrumented:
    """Async client also fires callbacks."""

    @pytest.mark.asyncio
    async def test_async_chat_events(self, async_client, callback):
        """Async chat fires on_request_start and on_request_end."""
        from unittest.mock import AsyncMock

        mock_resp = {
            "id": "chatcmpl-async",
            "object": "chat.completion",
            "created": 2000000,
            "model": "gpt-4o",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Async"},
                    "finish_reason": "stop",
                }
            ],
        }
        async_client._transport.async_request = AsyncMock(
            return_value=make_mock_response(json_data=mock_resp)
        )

        response = await async_client.chat.completions.create(
            model="auto",
            messages=[{"role": "user", "content": "Hello"}],
        )

        assert response.id == "chatcmpl-async"
        names = [e["name"] for e in callback.events]
        assert names == ["on_request_start", "on_request_end"]

    @pytest.mark.asyncio
    async def test_async_stream_events(self, async_client, callback):
        """Async streaming fires stream events."""
        async def _mock_lines(_path, _body):  # matches (path, body) signature
            yield 'data: {"type":"token","data":{"content":"A"},"index":0}\n'
            yield 'data: {"type":"done","data":{"requestId":"r1","modelId":"gpt-4o","finishReason":"stop"},"index":1}\n'

        # async_stream_lines is an async generator; assign it directly
        async_client._transport.async_stream_lines = _mock_lines

        stream = await async_client.chat.completions.create(
            model="auto",
            messages=[{"role": "user", "content": "Hi"}],
            stream=True,
        )

        chunks = []
        async for chunk in stream:
            chunks.append(chunk)

        assert len(chunks) == 2
        names = [e["name"] for e in callback.events]
        assert "on_stream_start" in names
        assert "on_stream_chunk" in names
        assert "on_stream_end" in names


# ── Test: Callbacks Do Not Break If They Raise ─────────────────────


class TestCallbackResilience:
    """A failing callback should not crash the request."""

    def test_broken_callback_does_not_crash(self):
        """If a callback raises, the request still succeeds."""

        class BrokenCallback(DMRXCallback):
            def on_request_start(self, endpoint, body):
                raise RuntimeError("callback broken")

            def on_request_end(self, endpoint, body, response, duration_ms):
                raise RuntimeError("callback broken")

        client = DMRXClient(
            api_key="test-key",
            base_url="http://localhost:3000",
            observe=BrokenCallback(),
        )

        mock_resp = {
            "id": "chatcmpl-broken",
            "object": "chat.completion",
            "created": 1000000,
            "model": "gpt-4o",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "OK"},
                    "finish_reason": "stop",
                }
            ],
        }
        client._transport.request = Mock(return_value=make_mock_response(json_data=mock_resp))

        # Should not raise — the callback error is swallowed
        response = client.chat.completions.create(
            model="auto",
            messages=[{"role": "user", "content": "Hello"}],
        )
        assert response.choices[0].message.content == "OK"


# ── Test: No Observe (default) ─────────────────────────────────────


class TestNoObserve:
    """Without observe, everything works as before."""

    def test_default_client_no_callbacks(self):
        """A client without observe has no callbacks."""
        client = DMRXClient(api_key="test-key")
        # Access internal callback mgr to verify
        assert len(client.chat.completions._callbacks.callbacks) == 0


# ── Test: Stub Integration Classes ─────────────────────────────────


class TestStubIntegrations:
    """Importing Langfuse/MLflow stubs without their libs."""

    def test_langfuse_stub_raises_on_init(self):
        """LangfuseCallback raises ImportError when langfuse not installed."""
        from dmrx.integrations.langfuse import LangfuseCallback
        with pytest.raises(ImportError, match="Langfuse is not installed"):
            LangfuseCallback()

    def test_mlflow_stub_raises_on_init(self):
        """MLflowCallback raises ImportError when mlflow not installed."""
        from dmrx.integrations.mlflow import MLflowCallback
        with pytest.raises(ImportError, match="MLflow is not installed"):
            MLflowCallback()
