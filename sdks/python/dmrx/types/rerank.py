from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class RerankRequest(BaseModel):
    model: str = Field(
        default="auto",
        description="Reranking model or meta-model alias",
    )
    query: str = Field(..., description="Search query")
    documents: List[str] = Field(..., description="Documents to rerank")
    top_n: Optional[int] = Field(
        None, ge=1, description="Number of top results to return"
    )
    user: Optional[str] = Field(None, description="End-user identifier")


class RerankResult(BaseModel):
    index: int = Field(..., description="Original document index")
    relevance_score: float = Field(..., description="Relevance score")
    document: Optional[str] = Field(None, description="Document text")


class RerankResponse(BaseModel):
    id: str = Field(..., description="Unique request identifier")
    model: str = Field(..., description="Model used")
    results: List[RerankResult] = Field(
        ..., description="Ranked results"
    )
    usage: Optional[Dict[str, Any]] = Field(None, description="Token usage")
