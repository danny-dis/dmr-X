"""
Audio TTS and STT request/response types for the DMR-X API.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class AudioSpeechRequest(BaseModel):
    """Request body for POST /v1/audio/speech (Text-to-Speech)."""

    model: str = Field(
        default="auto",
        description="TTS model or meta-model alias",
    )
    input: str = Field(..., description="Text to convert to speech")
    voice: str = Field(
        ..., description="Voice identifier"
    )
    speed: Optional[float] = Field(
        1.0, ge=0.25, le=4.0, description="Speech speed"
    )
    response_format: Optional[Literal["mp3", "opus", "aac", "flac", "wav"]] = Field(
        "mp3", description="Audio format"
    )
    language: Optional[str] = Field(
        None, description="Language code (e.g., 'en', 'es')"
    )


class AudioSpeechResponse(BaseModel):
    """Response for TTS — raw audio bytes (not JSON)."""
    # This is primarily a binary response; the model is for metadata
    content_type: str = Field("audio/mpeg", description="MIME type")
    data: bytes = Field(..., description="Raw audio bytes")


class AudioTranscriptionRequest(BaseModel):
    """Request body for POST /v1/audio/transcriptions (Speech-to-Text)."""

    model: str = Field(
        default="auto",
        description="STT model or meta-model alias",
    )
    audio: str = Field(
        ..., description="Base64-encoded audio data"
    )
    audio_format: Optional[Literal["wav", "mp3", "m4a", "webm"]] = Field(
        "wav", description="Audio file format"
    )
    language: Optional[str] = Field(
        None, description="Language code"
    )
    prompt: Optional[str] = Field(
        None, description="Optional context prompt"
    )
    response_format: Optional[Literal["json", "text", "srt", "vtt", "verbose_json"]] = Field(
        "json", description="Transcription output format"
    )
    temperature: Optional[float] = Field(
        None, ge=0, le=1, description="Sampling temperature"
    )


class TranscriptionSegment(BaseModel):
    """A segment of a transcription."""

    id: int = Field(..., description="Segment index")
    seek: int = Field(..., description="Seek position")
    start: float = Field(..., description="Start time in seconds")
    end: float = Field(..., description="End time in seconds")
    text: str = Field(..., description="Transcribed text")
    tokens: List[int] = Field(..., description="Token IDs")
    temperature: float = Field(..., description="Sampling temperature")
    avg_logprob: float = Field(..., description="Average log probability")
    compression_ratio: float = Field(..., description="Compression ratio")
    no_speech_prob: float = Field(..., description="No speech probability")


class AudioTranscriptionResponse(BaseModel):
    """Response body for POST /v1/audio/transcriptions."""

    text: str = Field(..., description="Transcribed text")
    segments: Optional[List[TranscriptionSegment]] = Field(
        None, description="Detailed segments (verbose_json format only)"
    )
    language: Optional[str] = Field(
        None, description="Detected language"
    )
    duration: Optional[float] = Field(
        None, description="Audio duration in seconds"
    )
