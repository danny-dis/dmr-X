"""
Video generation request/response types for the DMR-X API.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class CameraControl(BaseModel):
    """Camera movement control for video generation."""

    type: Literal["pan", "tilt", "zoom", "dolly", "crane", "tracking", "orbital"] = Field(
        ..., description="Camera movement type"
    )
    direction: Optional[str] = Field(
        None, description="Movement direction"
    )
    speed: Optional[Literal["slow", "medium", "fast"]] = Field(
        "medium", description="Camera speed"
    )


class VideoGenerationRequest(BaseModel):
    """Request body for POST /v1/video/generations."""

    model: str = Field(
        default="auto",
        description="Video model or meta-model alias",
    )
    prompt: str = Field(..., description="Video description")
    negative_prompt: Optional[str] = Field(
        None, description="What to avoid"
    )
    duration: Optional[int] = Field(
        None, ge=1, le=120, description="Video duration in seconds"
    )
    fps: Optional[int] = Field(
        None, ge=1, le=60, description="Frames per second"
    )
    aspect_ratio: Optional[str] = Field(
        None, description="Aspect ratio (e.g., '16:9', '9:16', '1:1')"
    )
    resolution: Optional[Literal["480p", "720p", "1080p", "4k"]] = Field(
        None, description="Target resolution"
    )
    generate_audio: Optional[bool] = Field(
        True, description="Generate audio track"
    )
    camera_fixed: Optional[bool] = Field(
        None, description="Keep camera fixed"
    )
    camera_control: Optional[CameraControl] = Field(
        None, description="Camera movement"
    )
    reference_images: Optional[List[str]] = Field(
        None, description="Reference image URLs (up to 9)"
    )
    reference_video: Optional[str] = Field(
        None, description="Reference video URL for style/motion"
    )
    last_frame_image: Optional[str] = Field(
        None, description="End-frame image URL"
    )
    edit_video: Optional[str] = Field(
        None, description="Video URL to edit"
    )
    edit_instruction: Optional[str] = Field(
        None, description="Text instruction for video editing"
    )
    extend_video: Optional[str] = Field(
        None, description="Video URL to extend"
    )
    user: Optional[str] = Field(None, description="End-user identifier")

    # DMR-X specific routing
    quality: Optional[str] = Field(
        None, description="Routing quality target"
    )
    provider_preference: Optional[List[str]] = Field(
        None, description="Preferred provider IDs"
    )


class GeneratedVideo(BaseModel):
    """A generated video."""

    url: Optional[str] = Field(None, description="Video URL")
    b64_json: Optional[str] = Field(None, description="Base64-encoded video")
    duration: Optional[float] = Field(
        None, description="Video duration in seconds"
    )
    fps: Optional[int] = Field(None, description="Frames per second")
    resolution: Optional[str] = Field(None, description="Video resolution")
    audio_url: Optional[str] = Field(
        None, description="Native audio track URL"
    )
    has_audio: Optional[bool] = Field(
        None, description="Whether video has audio"
    )


class VideoGenerationResponse(BaseModel):
    """Response body for POST /v1/video/generations."""

    created: int = Field(..., description="Creation timestamp (Unix epoch)")
    data: List[GeneratedVideo] = Field(
        ..., description="Generated videos"
    )
