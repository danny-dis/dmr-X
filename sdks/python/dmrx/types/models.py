"""
Model listing types for the DMR-X API.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class ModelPermission(BaseModel):
    """Permissions for a model."""

    id: str = Field(..., description="Permission ID")
    object: Literal["model_permission"] = Field(
        "model_permission", description="Object type"
    )
    created: int = Field(..., description="Creation timestamp")
    allow_create_engine: bool = Field(False)
    allow_sampling: bool = Field(True)
    allow_logprobs: bool = Field(True)
    allow_search_indices: bool = Field(False)
    allow_view: bool = Field(True)
    allow_fine_tuning: bool = Field(False)
    organization: str = Field("*")
    group: Optional[str] = Field(None)


class Model(BaseModel):
    """A model available through DMR-X."""

    id: str = Field(..., description="Model identifier")
    object: Literal["model"] = Field("model", description="Object type")
    created: int = Field(..., description="Creation timestamp (Unix epoch)")
    owned_by: str = Field(
        ..., description="Provider that owns this model"
    )
    permission: List[ModelPermission] = Field(
        default_factory=lambda: [
            ModelPermission(id="modelperm-default", created=0)
        ]
    )
    root: Optional[str] = Field(None, description="Root model ID")


class ModelList(BaseModel):
    """Response body for GET /v1/models."""

    object: Literal["list"] = Field("list", description="Object type")
    data: List[Model] = Field(
        ..., description="List of available models"
    )
