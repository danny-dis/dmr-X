"""
Chat completion request/response types for the DMR-X API.
Mirrors the OpenAI chat completions wire format for drop-in compatibility.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field

from .shared import Message, QualityTarget, Tool, TokenUsage


class ChatCompletionRequest(BaseModel):
    """Request body for POST /v1/chat/completions (OpenAI-compatible format)."""

    model: str = Field(
        ...,
        description="Model name or meta-model alias (auto, auto-fast, auto-smart, auto-agentic, auto-coding)",
    )
    messages: List[Message] = Field(
        ..., description="Conversation messages"
    )
    temperature: Optional[float] = Field(
        None, ge=0, le=2, description="Sampling temperature"
    )
    max_tokens: Optional[int] = Field(
        None, ge=1, description="Maximum response tokens"
    )
    top_p: Optional[float] = Field(None, ge=0, le=1, description="Nucleus sampling")
    frequency_penalty: Optional[float] = Field(
        None, ge=-2, le=2, description="Frequency penalty"
    )
    presence_penalty: Optional[float] = Field(
        None, ge=-2, le=2, description="Presence penalty"
    )
    stop: Optional[Union[str, List[str]]] = Field(
        None, description="Stop sequences"
    )
    stream: Optional[bool] = Field(
        False, description="Enable streaming response"
    )
    tools: Optional[List[Tool]] = Field(
        None, description="Available tools/functions"
    )
    tool_choice: Optional[Union[Literal["auto", "none", "required"], Dict[str, Any]]] = Field(
        None, description="Tool selection strategy"
    )
    response_format: Optional[Dict[str, Any]] = Field(
        None, description="Response format (text or json_object)"
    )
    seed: Optional[int] = Field(None, description="Random seed")
    n: Optional[int] = Field(None, ge=1, description="Number of completions")
    user: Optional[str] = Field(None, description="End-user identifier")

    # DMR-X specific routing parameters
    quality: Optional[QualityTarget] = Field(
        None, description="Routing quality target"
    )
    provider_preference: Optional[List[str]] = Field(
        None, description="Preferred provider IDs"
    )
    provider_blacklist: Optional[List[str]] = Field(
        None, description="Provider IDs to exclude"
    )
    latency_target: Optional[Union[int, str]] = Field(
        None, description="Max acceptable latency (ms or string like '100ms')"
    )
    cost_target: Optional[Union[float, str]] = Field(
        None, description="Max cost per 1M output tokens"
    )
    local_first: Optional[bool] = Field(
        None, description="Prefer local models (Ollama)"
    )
    require_privacy: Optional[bool] = Field(
        None, description="Force privacy-preserving providers only"
    )


class ChatCompletionChoice(BaseModel):
    """A single completion choice."""

    index: int = Field(..., description="Choice index")
    message: Message = Field(..., description="Response message")
    finish_reason: Optional[Literal["stop", "length", "tool_calls", "content_filter"]] = Field(
        None, description="Reason the model stopped generating"
    )


class ChatCompletionResponse(BaseModel):
    """Response body for POST /v1/chat/completions (OpenAI-compatible format)."""

    id: str = Field(..., description="Unique request identifier")
    object: Literal["chat.completion"] = Field(
        "chat.completion", description="Object type"
    )
    created: int = Field(..., description="Creation timestamp (Unix epoch)")
    model: str = Field(..., description="Model used")
    choices: List[ChatCompletionChoice] = Field(
        ..., description="Completion choices"
    )
    usage: Optional[TokenUsage] = Field(None, description="Token usage")

    # DMR-X specific metadata
    provider: Optional[str] = Field(
        None, description="Provider that served the request"
    )
    latency_ms: Optional[float] = Field(
        None, description="Total request latency in milliseconds"
    )
