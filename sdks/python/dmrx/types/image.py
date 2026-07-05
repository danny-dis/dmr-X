"""
Image generation request/response types for the DMR-X API.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class ImageGenerationRequest(BaseModel):
    """Request body for POST /v1/images/generations."""

    model: str = Field(
        default="auto",
        description="Model name or meta-model alias",
    )
    prompt: str = Field(..., description="Image description")
    negative_prompt: Optional[str] = Field(
        None, description="What to avoid in the image"
    )
    n: Optional[int] = Field(
        1, ge=1, le=10, description="Number of images to generate"
    )
    size: Optional[str] = Field(
        None, description="Image size (e.g., 1024x1024, 512x512)"
    )
    width: Optional[int] = Field(None, ge=64, le=4096, description="Image width")
    height: Optional[int] = Field(None, ge=64, le=4096, description="Image height")
    steps: Optional[int] = Field(
        None, ge=1, le=100, description="Diffusion steps"
    )
    style: Optional[str] = Field(
        None, description="Image style (e.g., vivid, natural)"
    )
    quality: Optional[str] = Field(
        None, description="Image quality (e.g., standard, hd)"
    )
    response_format: Optional[Literal["url", "b64_json"]] = Field(
        "url", description="Response format"
    )
    user: Optional[str] = Field(None, description="End-user identifier")


class GeneratedImage(BaseModel):
    """A generated image."""

    url: Optional[str] = Field(None, description="Image URL")
    b64_json: Optional[str] = Field(None, description="Base64-encoded image")
    revised_prompt: Optional[str] = Field(
        None, description="Provider-revised prompt"
    )


class ImageGenerationResponse(BaseModel):
    """Response body for POST /v1/images/generations."""

    created: int = Field(..., description="Creation timestamp (Unix epoch)")
    data: List[GeneratedImage] = Field(
        ..., description="Generated images"
    )
