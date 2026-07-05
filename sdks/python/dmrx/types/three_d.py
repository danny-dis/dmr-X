from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class ThreeDRequest(BaseModel):
    model: str = Field(
        default="auto",
        description="3D model or meta-model alias",
    )
    prompt: str = Field(..., description="3D content description")
    format: Optional[Literal["glb", "obj", "stl", "ply"]] = Field(
        "glb", description="Output 3D format"
    )
    resolution: Optional[Literal["low", "medium", "high"]] = Field(
        "medium", description="Mesh resolution"
    )
    user: Optional[str] = Field(None, description="End-user identifier")


class ThreeDResponse(BaseModel):
    id: str = Field(..., description="Unique request identifier")
    model: str = Field(..., description="Model used")
    url: str = Field(..., description="3D model URL")
    format: str = Field(..., description="Output format")
