from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class AudioSeparationRequest(BaseModel):
    model: str = Field(
        default="auto",
        description="Audio separation model or meta-model alias",
    )
    audio: str = Field(..., description="Base64-encoded audio data")
    stems: Optional[List[str]] = Field(
        None,
        description="Stems to extract (e.g., ['vocals', 'drums', 'bass', 'other'])",
    )
    user: Optional[str] = Field(None, description="End-user identifier")


class AudioStem(BaseModel):
    name: str = Field(..., description="Stem name (vocals, drums, bass, other)")
    audio: str = Field(..., description="Base64-encoded stem audio data")
    sample_rate: Optional[int] = Field(
        None, description="Sample rate in Hz"
    )


class AudioSeparationResponse(BaseModel):
    id: str = Field(..., description="Unique request identifier")
    model: str = Field(..., description="Model used")
    stems: List[AudioStem] = Field(
        ..., description="Separated audio stems"
    )
