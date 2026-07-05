"""
Embedding request/response types for the DMR-X API.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class EmbeddingRequest(BaseModel):
    """Request body for POST /v1/embeddings."""

    model: str = Field(
        default="auto",
        description="Model name or meta-model alias",
    )
    input: List[str] = Field(
        ..., description="Text inputs to embed"
    )
    dimensions: Optional[int] = Field(
        None, description="Number of embedding dimensions"
    )
    encoding_format: Optional[Literal["float", "base64"]] = Field(
        "float", description="Embedding encoding format"
    )
    user: Optional[str] = Field(None, description="End-user identifier")


class EmbeddingData(BaseModel):
    """A single embedding vector."""

    index: int = Field(..., description="Index in the input list")
    embedding: List[float] = Field(
        ..., description="Embedding vector (floats by default)"
    )
    object: Literal["embedding"] = Field(
        "embedding", description="Object type"
    )


class EmbeddingUsage(BaseModel):
    """Token usage for embedding requests."""

    prompt_tokens: int = Field(..., description="Tokens in the input")
    total_tokens: int = Field(..., description="Total tokens used")


class EmbeddingResponse(BaseModel):
    """Response body for POST /v1/embeddings."""

    object: Literal["list"] = Field("list", description="Object type")
    data: List[EmbeddingData] = Field(
        ..., description="List of embeddings"
    )
    model: str = Field(..., description="Model used")
    usage: EmbeddingUsage = Field(..., description="Token usage")
