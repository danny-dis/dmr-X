"""
DMR-X Python SDK — Unified AI Gateway Client.

Usage:
    from dmrx import DMRXClient

    client = DMRXClient(api_key="dmrx_...", base_url="http://localhost:3000")

    # Chat completion (sync)
    response = client.chat.completions.create(
        model="auto-coding",
        messages=[{"role": "user", "content": "Hello!"}],
    )
    print(response.choices[0].message.content)

    # Streaming
    stream = client.chat.completions.create(
        model="auto",
        messages=[{"role": "user", "content": "Write a poem"}],
        stream=True,
    )
    for chunk in stream:
        print(chunk.data.get("content", ""), end="")

    # Observability
    from dmrx.integrations.langfuse import LangfuseCallback

    client = DMRXClient(
        api_key="dmrx_...",
        observe=LangfuseCallback(),
    )
"""

from __future__ import annotations

import time
from typing import (
    Any,
    AsyncIterator,
    Dict,
    Iterator,
    List,
    Literal,
    Optional,
    Union,
)

from ._http import HTTPTransport
from .callbacks import CallbackManager, DMRXCallback
from .errors import DMRXError
from .streaming import AsyncStream, Stream
from .types.chat import ChatCompletionRequest, ChatCompletionResponse
from .types.embedding import EmbeddingRequest, EmbeddingResponse
from .types.image import ImageGenerationRequest, ImageGenerationResponse
from .types.audio import (
    AudioSpeechRequest,
    AudioSpeechResponse,
    AudioTranscriptionRequest,
    AudioTranscriptionResponse,
)
from .types.video import (
    VideoGenerationRequest,
    VideoGenerationResponse,
    GeneratedVideo,
)
from .types.models import Model, ModelList


# ── Internal: instrumented request helpers ─────────────────────────


def _instrumented_request(
    transport: HTTPTransport,
    callbacks: CallbackManager,
    method: str,
    path: str,
    endpoint: str,
    body: Dict[str, Any],
) -> Dict[str, Any]:
    """Make an HTTP request with callback instrumentation (sync)."""
    callbacks.on_request_start(endpoint, body)
    start = time.monotonic()
    try:
        response = transport.request(method, path, json_body=body)
        duration = (time.monotonic() - start) * 1000
        result = response.json()
        callbacks.on_request_end(endpoint, body, result, duration)
        return result
    except Exception as e:
        duration = (time.monotonic() - start) * 1000
        callbacks.on_request_error(endpoint, body, e, duration)
        raise


async def _async_instrumented_request(
    transport: HTTPTransport,
    callbacks: CallbackManager,
    method: str,
    path: str,
    endpoint: str,
    body: Dict[str, Any],
) -> Dict[str, Any]:
    """Make an HTTP request with callback instrumentation (async)."""
    callbacks.on_request_start(endpoint, body)
    start = time.monotonic()
    try:
        response = await transport.async_request(method, path, json_body=body)
        duration = (time.monotonic() - start) * 1000
        result = response.json()
        callbacks.on_request_end(endpoint, body, result, duration)
        return result
    except Exception as e:
        duration = (time.monotonic() - start) * 1000
        callbacks.on_request_error(endpoint, body, e, duration)
        raise


# ── Chat Completions ──────────────────────────────────────────────


class ChatCompletions:
    """Chat completion endpoints (mirrors OpenAI SDK structure)."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    def create(
        self,
        **kwargs: Any,
    ) -> Union[ChatCompletionResponse, "Stream"]:
        """
        Create a chat completion.

        If ``stream=True``, returns a ``Stream`` iterator.
        Otherwise, returns a ``ChatCompletionResponse``.

        Accepts the same parameters as ``ChatCompletionRequest``.
        """
        request = ChatCompletionRequest(**kwargs)
        body = request.model_dump(exclude_none=True)

        if body.get("stream", False):
            self._callbacks.on_stream_start("chat.completions", body)
            lines = self._transport.stream_lines(
                "/v1/chat/completions", body
            )
            return Stream(
                lines,
                endpoint="chat.completions",
                request_body=body,
                callbacks=self._callbacks,
            )

        # Non-streaming
        result = _instrumented_request(
            self._transport,
            self._callbacks,
            "POST",
            "/v1/chat/completions",
            "chat.completions",
            body,
        )
        return ChatCompletionResponse(**result)


class AsyncChatCompletions:
    """Async chat completion endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    async def create(
        self,
        **kwargs: Any,
    ) -> Union[ChatCompletionResponse, AsyncStream]:
        """Create a chat completion (async)."""
        request = ChatCompletionRequest(**kwargs)
        body = request.model_dump(exclude_none=True)

        if body.get("stream", False):
            self._callbacks.on_stream_start("chat.completions", body)
            # async_stream_lines is an async generator — no await
            lines = self._transport.async_stream_lines(
                "/v1/chat/completions", body
            )
            return AsyncStream(
                lines,
                endpoint="chat.completions",
                request_body=body,
                callbacks=self._callbacks,
            )

        # Non-streaming
        result = await _async_instrumented_request(
            self._transport,
            self._callbacks,
            "POST",
            "/v1/chat/completions",
            "chat.completions",
            body,
        )
        return ChatCompletionResponse(**result)


class Chat:
    """Chat-related endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self.completions = ChatCompletions(transport, callbacks)


class AsyncChat:
    """Async chat-related endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self.completions = AsyncChatCompletions(transport, callbacks)


# ── Models ────────────────────────────────────────────────────────


class Models:
    """Model listing endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    def list(self) -> ModelList:
        """List all available models."""
        result = _instrumented_request(
            self._transport,
            self._callbacks,
            "GET",
            "/v1/models",
            "models.list",
            {},
        )
        return ModelList(**result)

    def retrieve(self, model_id: str) -> Model:
        """Get a single model by ID."""
        result = _instrumented_request(
            self._transport,
            self._callbacks,
            "GET",
            f"/v1/models/{model_id}",
            "models.retrieve",
            {},
        )
        return Model(**result)


class AsyncModels:
    """Async model listing endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    async def list(self) -> ModelList:
        """List all available models (async)."""
        result = await _async_instrumented_request(
            self._transport,
            self._callbacks,
            "GET",
            "/v1/models",
            "models.list",
            {},
        )
        return ModelList(**result)

    async def retrieve(self, model_id: str) -> Model:
        """Get a single model by ID (async)."""
        result = await _async_instrumented_request(
            self._transport,
            self._callbacks,
            "GET",
            f"/v1/models/{model_id}",
            "models.retrieve",
            {},
        )
        return Model(**result)


# ── Embeddings ────────────────────────────────────────────────────


class Embeddings:
    """Embedding endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    def create(self, **kwargs: Any) -> EmbeddingResponse:
        """Create embeddings."""
        request = EmbeddingRequest(**kwargs)
        body = request.model_dump(exclude_none=True)
        result = _instrumented_request(
            self._transport,
            self._callbacks,
            "POST",
            "/v1/embeddings",
            "embeddings",
            body,
        )
        return EmbeddingResponse(**result)


class AsyncEmbeddings:
    """Async embedding endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    async def create(self, **kwargs: Any) -> EmbeddingResponse:
        """Create embeddings (async)."""
        request = EmbeddingRequest(**kwargs)
        body = request.model_dump(exclude_none=True)
        result = await _async_instrumented_request(
            self._transport,
            self._callbacks,
            "POST",
            "/v1/embeddings",
            "embeddings",
            body,
        )
        return EmbeddingResponse(**result)


# ── Images ────────────────────────────────────────────────────────


class Images:
    """Image generation endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    def generate(self, **kwargs: Any) -> ImageGenerationResponse:
        """Generate images."""
        request = ImageGenerationRequest(**kwargs)
        body = request.model_dump(exclude_none=True)
        result = _instrumented_request(
            self._transport,
            self._callbacks,
            "POST",
            "/v1/images/generations",
            "images.generations",
            body,
        )
        return ImageGenerationResponse(**result)


class AsyncImages:
    """Async image generation endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    async def generate(self, **kwargs: Any) -> ImageGenerationResponse:
        """Generate images (async)."""
        request = ImageGenerationRequest(**kwargs)
        body = request.model_dump(exclude_none=True)
        result = await _async_instrumented_request(
            self._transport,
            self._callbacks,
            "POST",
            "/v1/images/generations",
            "images.generations",
            body,
        )
        return ImageGenerationResponse(**result)


# ── Videos ────────────────────────────────────────────────────────


class Videos:
    """Video generation endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    def generate(self, **kwargs: Any) -> VideoGenerationResponse:
        """Generate videos."""
        request = VideoGenerationRequest(**kwargs)
        body = request.model_dump(exclude_none=True)
        result = _instrumented_request(
            self._transport,
            self._callbacks,
            "POST",
            "/v1/video/generations",
            "video.generations",
            body,
        )
        return VideoGenerationResponse(**result)


class AsyncVideos:
    """Async video generation endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    async def generate(self, **kwargs: Any) -> VideoGenerationResponse:
        """Generate videos (async)."""
        request = VideoGenerationRequest(**kwargs)
        body = request.model_dump(exclude_none=True)
        result = await _async_instrumented_request(
            self._transport,
            self._callbacks,
            "POST",
            "/v1/video/generations",
            "video.generations",
            body,
        )
        return VideoGenerationResponse(**result)


# ── Audio ─────────────────────────────────────────────────────────


class Audio:
    """Audio TTS and STT endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    def speech(self, **kwargs: Any) -> AudioSpeechResponse:
        """Text-to-speech."""
        request = AudioSpeechRequest(**kwargs)
        body = request.model_dump(exclude_none=True)
        self._callbacks.on_request_start("audio.speech", body)
        start = time.monotonic()
        try:
            raw_resp = self._transport.request(
                "POST", "/v1/audio/speech", json_body=body
            )
            duration = (time.monotonic() - start) * 1000
            content_type = raw_resp.headers.get("content-type", "audio/mpeg")
            resp_data = raw_resp.content
            # Fire end hook with metadata (not binary data)
            self._callbacks.on_request_end(
                "audio.speech",
                body,
                {"content_type": content_type, "size_bytes": len(resp_data)},
                duration,
            )
            return AudioSpeechResponse(
                content_type=content_type,
                data=resp_data,
            )
        except Exception as e:
            duration = (time.monotonic() - start) * 1000
            self._callbacks.on_request_error("audio.speech", body, e, duration)
            raise

    def transcriptions(self, **kwargs: Any) -> AudioTranscriptionResponse:
        """Speech-to-text."""
        request = AudioTranscriptionRequest(**kwargs)
        body = request.model_dump(exclude_none=True)
        result = _instrumented_request(
            self._transport,
            self._callbacks,
            "POST",
            "/v1/audio/transcriptions",
            "audio.transcriptions",
            body,
        )
        return AudioTranscriptionResponse(**result)


class AsyncAudio:
    """Async audio endpoints."""

    def __init__(
        self,
        transport: HTTPTransport,
        callbacks: Optional[CallbackManager] = None,
    ) -> None:
        self._transport = transport
        self._callbacks = callbacks or CallbackManager()

    async def speech(self, **kwargs: Any) -> AudioSpeechResponse:
        """Text-to-speech (async)."""
        request = AudioSpeechRequest(**kwargs)
        body = request.model_dump(exclude_none=True)
        self._callbacks.on_request_start("audio.speech", body)
        start = time.monotonic()
        try:
            raw_resp = await self._transport.async_request(
                "POST", "/v1/audio/speech", json_body=body
            )
            duration = (time.monotonic() - start) * 1000
            content_type = raw_resp.headers.get("content-type", "audio/mpeg")
            resp_data = raw_resp.content
            self._callbacks.on_request_end(
                "audio.speech",
                body,
                {"content_type": content_type, "size_bytes": len(resp_data)},
                duration,
            )
            return AudioSpeechResponse(
                content_type=content_type,
                data=resp_data,
            )
        except Exception as e:
            duration = (time.monotonic() - start) * 1000
            self._callbacks.on_request_error("audio.speech", body, e, duration)
            raise

    async def transcriptions(self, **kwargs: Any) -> AudioTranscriptionResponse:
        """Speech-to-text (async)."""
        request = AudioTranscriptionRequest(**kwargs)
        body = request.model_dump(exclude_none=True)
        result = await _async_instrumented_request(
            self._transport,
            self._callbacks,
            "POST",
            "/v1/audio/transcriptions",
            "audio.transcriptions",
            body,
        )
        return AudioTranscriptionResponse(**result)


# ── Main Client Classes ───────────────────────────────────────────


class DMRXClient:
    """
    Main DMR-X API client.

    Provides access to all DMR-X API endpoints through namespaced
    attributes, mirroring the OpenAI Python SDK convention.

    Args:
        api_key: DMR-X API key (starts with ``dmrx_``).
        base_url: DMR-X gateway URL (default: ``http://localhost:3000``).
        timeout: Request timeout in seconds (default: 60).
        max_retries: Number of automatic retries on 5xx errors (default: 0).
        observe: Observability integration. One of:

            - A ``DMRXCallback`` instance
            - A list of ``DMRXCallback`` instances
            - The string ``"langfuse"`` or ``"mlflow"`` (auto-configures
              from environment variables)
            - ``True`` (auto-detects from ``DMRX_OBSERVABILITY_BACKEND``
              env var)
            - ``None`` (no instrumentation, default)

    Usage:
        client = DMRXClient(api_key="dmrx_...")

        # Chat
        response = client.chat.completions.create(
            model="auto-coding",
            messages=[{"role": "user", "content": "Hello"}],
        )

        # Models
        models = client.models.list()

        # Embeddings
        embeddings = client.embeddings.create(
            input=["Hello world"],
            model="auto",
        )
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:3000",
        timeout: float = 60.0,
        max_retries: int = 0,
        observe: Optional[
            Union[DMRXCallback, List[DMRXCallback], str, bool]
        ] = None,
    ) -> None:
        self._transport = HTTPTransport(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
            max_retries=max_retries,
        )

        cb_mgr = CallbackManager(observe)

        # Namespaced endpoints
        self.chat = Chat(self._transport, cb_mgr)
        self.models = Models(self._transport, cb_mgr)
        self.embeddings = Embeddings(self._transport, cb_mgr)
        self.images = Images(self._transport, cb_mgr)
        self.videos = Videos(self._transport, cb_mgr)
        self.audio = Audio(self._transport, cb_mgr)

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._transport.close()


class AsyncDMRXClient:
    """
    Async DMR-X API client.

    Same interface as ``DMRXClient`` but all methods are async.

    Args:
        api_key: DMR-X API key (starts with ``dmrx_``).
        base_url: DMR-X gateway URL (default: ``http://localhost:3000``).
        timeout: Request timeout in seconds (default: 60).
        max_retries: Number of automatic retries on 5xx errors (default: 0).
        observe: Observability integration. Same semantics as
            ``DMRXClient.observe``.

    Usage:
        client = AsyncDMRXClient(api_key="dmrx_...")

        response = await client.chat.completions.create(
            model="auto-coding",
            messages=[{"role": "user", "content": "Hello"}],
        )
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:3000",
        timeout: float = 60.0,
        max_retries: int = 0,
        observe: Optional[
            Union[DMRXCallback, List[DMRXCallback], str, bool]
        ] = None,
    ) -> None:
        self._transport = HTTPTransport(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
            max_retries=max_retries,
        )

        cb_mgr = CallbackManager(observe)

        # Namespaced endpoints
        self.chat = AsyncChat(self._transport, cb_mgr)
        self.models = AsyncModels(self._transport, cb_mgr)
        self.embeddings = AsyncEmbeddings(self._transport, cb_mgr)
        self.images = AsyncImages(self._transport, cb_mgr)
        self.videos = AsyncVideos(self._transport, cb_mgr)
        self.audio = AsyncAudio(self._transport, cb_mgr)

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._transport.aclose()
