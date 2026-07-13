from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class ModerationRequest(BaseModel):
    model: str = Field(
        default="auto",
        description="Moderation model or meta-model alias",
    )
    input: str = Field(..., description="Text to moderate")
    user: Optional[str] = Field(None, description="End-user identifier")


class ModerationResult(BaseModel):
    flagged: bool = Field(..., description="Whether content was flagged")
    categories: Dict[str, bool] = Field(
        default_factory=dict, description="Category flags"
    )
    category_scores: Dict[str, float] = Field(
        default_factory=dict, description="Category scores"
    )


class ModerationResponse(BaseModel):
    id: str = Field(..., description="Unique request identifier")
    model: str = Field(..., description="Model used")
    results: List[ModerationResult] = Field(
        ..., description="Moderation results"
    )
