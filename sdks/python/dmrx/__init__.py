"""
DMR-X Python SDK.

Universal AI routing and orchestration — a single client that routes
requests to the best available provider using intelligent meta-model aliases.

Usage:
    from dmrx import DMRXClient

    client = DMRXClient(api_key="dmrx_...")
    response = client.chat.completions.create(
        model="auto-coding",
        messages=[{"role": "user", "content": "Hello!"}],
    )
    print(response.choices[0].message.content)

    # With Langfuse observability:
    from dmrx.integrations.langfuse import LangfuseCallback

    client = DMRXClient(
        api_key="dmrx_...",
        observe=LangfuseCallback(),
    )
"""

from .callbacks import CallbackManager, DMRXCallback
from .client import AsyncDMRXClient, DMRXClient
from .errors import (
    AllProvidersFailedError,
    AuthenticationError,
    DMRXError,
    ProviderError,
    ProviderUnavailableError,
    QuotaExhaustedError,
    RateLimitError,
    ValidationError,
)
from .types.chat import ChatCompletionRequest, ChatCompletionResponse
from .types.embedding import EmbeddingRequest, EmbeddingResponse
from .types.image import ImageGenerationRequest, ImageGenerationResponse
from .types.audio import (
    AudioSpeechRequest,
    AudioSpeechResponse,
    AudioTranscriptionRequest,
    AudioTranscriptionResponse,
)
from .types.video import VideoGenerationRequest, VideoGenerationResponse
from .types.models import Model, ModelList
from .types.shared import Modality, QualityTarget, StreamChunk, TokenUsage
from .types.moderations import ModerationRequest, ModerationResponse, ModerationResult
from .types.rerank import RerankRequest, RerankResponse, RerankResult
from .types.ocr import OcrRequest, OcrResponse, OcrResult
from .types.audio_separation import AudioSeparationRequest, AudioSeparationResponse, AudioStem
from .types.three_d import ThreeDRequest, ThreeDResponse

__all__ = [
    "DMRXClient",
    "AsyncDMRXClient",
    "DMRXCallback",
    "CallbackManager",
    # Errors
    "DMRXError",
    "AuthenticationError",
    "ValidationError",
    "RateLimitError",
    "QuotaExhaustedError",
    "ProviderError",
    "AllProvidersFailedError",
    "ProviderUnavailableError",
    # Types
    "ChatCompletionRequest",
    "ChatCompletionResponse",
    "EmbeddingRequest",
    "EmbeddingResponse",
    "ImageGenerationRequest",
    "ImageGenerationResponse",
    "AudioSpeechRequest",
    "AudioSpeechResponse",
    "AudioTranscriptionRequest",
    "AudioTranscriptionResponse",
    "VideoGenerationRequest",
    "VideoGenerationResponse",
    "Model",
    "ModelList",
    "Modality",
    "QualityTarget",
    "StreamChunk",
    "TokenUsage",
    "ModerationRequest",
    "ModerationResponse",
    "ModerationResult",
    "RerankRequest",
    "RerankResponse",
    "RerankResult",
    "OcrRequest",
    "OcrResponse",
    "OcrResult",
    "AudioSeparationRequest",
    "AudioSeparationResponse",
    "AudioStem",
    "ThreeDRequest",
    "ThreeDResponse",
]

__version__ = "0.1.0"
