from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class OcrRequest(BaseModel):
    model: str = Field(
        default="auto",
        description="OCR model or meta-model alias",
    )
    image: str = Field(..., description="Base64-encoded image")
    language: Optional[str] = Field(
        None, description="Language code (e.g., 'en', 'zh')"
    )
    user: Optional[str] = Field(None, description="End-user identifier")


class OcrResult(BaseModel):
    text: str = Field(..., description="Extracted text")
    confidence: float = Field(
        ..., description="Confidence score (0-1)"
    )
    bounding_box: Optional[List[float]] = Field(
        None, description="Bounding box coordinates [x1, y1, x2, y2]"
    )


class OcrResponse(BaseModel):
    id: str = Field(..., description="Unique request identifier")
    model: str = Field(..., description="Model used")
    results: List[OcrResult] = Field(..., description="OCR results")
