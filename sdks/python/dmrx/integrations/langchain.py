"""
LangChain integration for DMR-X.

Provides a LangChain chat model wrapper that routes through DMR-X's
intelligent provider selection.

Usage:
    from dmrx.integrations.langchain import ChatDMRX

    llm = ChatDMRX(
        model="auto-coding",
        api_key="dmrx_...",
        base_url="http://localhost:3000",
    )

    # Standard LangChain usage
    response = llm.invoke([HumanMessage(content="Hello!")])
    print(response.content)

    # Streaming
    for chunk in llm.stream([HumanMessage(content="Write a poem")]):
        print(chunk.content, end="")

    # Tool calling
    llm_with_tools = llm.bind_tools([...])
    response = llm_with_tools.invoke([...])

    # DMR-X specific routing
    llm = ChatDMRX(
        model="auto",
        quality="frontier",
        provider_preference=["openai", "anthropic"],
    )
"""

from __future__ import annotations

import json
from typing import (
    Any,
    AsyncIterator,
    Dict,
    Iterator,
    List,
    Literal,
    Optional,
    Sequence,
    Type,
    Union,
)

from langchain_core.callbacks import (
    AsyncCallbackManagerForLLMRun,
    CallbackManagerForLLMRun,
)
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, LLMResult
from langchain_core.runnables import run_in_executor
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field, PrivateAttr

from dmrx import DMRXClient
from dmrx.types.shared import ToolCall


# ── Message Conversion ────────────────────────────────────────────


def _convert_lc_message_to_dmrx(msg: BaseMessage) -> dict:
    """Convert a LangChain message to DMR-X API format."""
    content = msg.content
    if isinstance(content, list):
        content = [
            {
                "type": part["type"],
                **({"text": part["text"]} if part.get("text") else {}),
                **({"image_url": part["image_url"]} if part.get("image_url") else {}),
            }
            for part in content
        ]

    result: dict = {"role": _role(msg), "content": content}

    if msg.name:
        result["name"] = msg.name

    if isinstance(msg, AIMessage) and msg.tool_calls:
        result["tool_calls"] = [
            {
                "id": tc["id"],
                "type": "function",
                "function": {
                    "name": tc["name"],
                    "arguments": json.dumps(tc["args"]),
                },
            }
            for tc in msg.tool_calls
        ]

    if isinstance(msg, ToolMessage):
        result["tool_call_id"] = msg.tool_call_id

    return result


def _role(msg: BaseMessage) -> str:
    """Map LangChain message types to DMR-X roles."""
    if isinstance(msg, HumanMessage):
        return "user"
    elif isinstance(msg, AIMessage):
        return "assistant"
    elif isinstance(msg, SystemMessage):
        return "system"
    elif isinstance(msg, ToolMessage):
        return "tool"
    else:
        return "user"


def _convert_dmrx_message_to_lc(msg: dict) -> AIMessage:
    """Convert a DMR-X response message to a LangChain AIMessage."""
    content = msg.get("content", "")
    tool_calls_data = msg.get("tool_calls", [])

    if isinstance(content, list):
        texts = [p.get("text", "") for p in content if p.get("type") == "text"]
        content = "".join(texts) if texts else ""

    tool_calls: List[dict] = []
    for tc in tool_calls_data:
        if isinstance(tc, ToolCall):
            tc_func = tc.function
            tc_id = tc.id
        else:
            tc_func = tc.get("function", {})
            tc_id = tc.get("id", "")
        try:
            args = json.loads(tc_func.get("arguments", "{}"))
        except (json.JSONDecodeError, TypeError):
            args = {}
        tool_calls.append({
            "id": tc_id,
            "name": tc_func.get("name", ""),
            "args": args,
        })

    return AIMessage(
        content=content,
        tool_calls=tool_calls,
        additional_kwargs={
            "provider": msg.get("provider", ""),
            "latency_ms": msg.get("latency_ms"),
        },
    )


# ── Chat Model ────────────────────────────────────────────────────


class ChatDMRX(BaseChatModel):
    """
    LangChain chat model wrapper for DMR-X.

    Routes all requests through DMR-X's intelligent provider selection,
    supporting meta-model aliases, streaming, tool calling, and all
    DMR-X routing parameters.

    Args:
        model: Model name or meta-model alias (auto, auto-coding, etc.)
        api_key: DMR-X API key
        base_url: DMR-X gateway URL
        temperature: Sampling temperature (0-2)
        max_tokens: Maximum response tokens
        top_p: Nucleus sampling parameter
        timeout: Request timeout in seconds
        max_retries: Number of retries on 5xx errors
        quality: Routing quality target (frontier, balanced, economy)
        provider_preference: Ordered list of preferred provider IDs
        provider_blacklist: Provider IDs to exclude
        latency_target: Maximum acceptable latency
        cost_target: Max cost per 1M output tokens
        local_first: Prefer local models
        require_privacy: Force privacy-preserving providers only
        **kwargs: Additional LangChain BaseChatModel arguments
    """

    model: str = Field(default="auto", description="Model name or meta-model alias")
    api_key: str = Field(default="", description="DMR-X API key")
    base_url: str = Field(default="http://localhost:3000", description="DMR-X gateway URL")
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    max_tokens: Optional[int] = Field(default=None, ge=1)
    top_p: Optional[float] = Field(default=None, ge=0, le=1)
    timeout: float = Field(default=60.0, ge=1)
    max_retries: int = Field(default=0, ge=0)

    # DMR-X specific routing
    quality: Optional[Literal["frontier", "balanced", "economy"]] = Field(default=None)
    provider_preference: Optional[List[str]] = Field(default=None)
    provider_blacklist: Optional[List[str]] = Field(default=None)
    latency_target: Optional[Union[int, str]] = Field(default=None)
    cost_target: Optional[Union[float, str]] = Field(default=None)
    local_first: Optional[bool] = Field(default=None)
    require_privacy: Optional[bool] = Field(default=None)

    _client: DMRXClient = PrivateAttr()

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._client = DMRXClient(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout,
            max_retries=self.max_retries,
        )

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    @property
    def _llm_type(self) -> str:
        return "dmrx"

    def _convert_messages_to_dicts(
        self, messages: List[BaseMessage]
    ) -> List[dict]:
        """Convert LangChain messages to DMR-X API format."""
        return [_convert_lc_message_to_dmrx(m) for m in messages]

    def _build_request_kwargs(self, **kwargs: Any) -> Dict[str, Any]:
        """Build the DMR-X API request parameters."""
        request_kwargs: Dict[str, Any] = {
            "model": kwargs.pop("model", self.model),
            "temperature": kwargs.pop("temperature", self.temperature),
            "max_tokens": kwargs.pop("max_tokens", self.max_tokens),
            "top_p": kwargs.pop("top_p", self.top_p),
            "quality": kwargs.pop("quality", self.quality),
            "provider_preference": kwargs.pop(
                "provider_preference", self.provider_preference
            ),
            "provider_blacklist": kwargs.pop(
                "provider_blacklist", self.provider_blacklist
            ),
            "latency_target": kwargs.pop("latency_target", self.latency_target),
            "cost_target": kwargs.pop("cost_target", self.cost_target),
            "local_first": kwargs.pop("local_first", self.local_first),
            "require_privacy": kwargs.pop("require_privacy", self.require_privacy),
        }

        # Handle tools
        tools = kwargs.pop("tools", None)
        if tools:
            request_kwargs["tools"] = self._convert_tools(tools)

        # Pass through remaining kwargs (frequency_penalty, presence_penalty,
        # seed, n, user, response_format, tool_choice, etc.)
        request_kwargs.update(kwargs)

        # Remove None values
        return {k: v for k, v in request_kwargs.items() if v is not None}

    def _convert_tools(
        self, tools: Sequence[Union[Dict[str, Any], Type[BaseModel], BaseTool]]
    ) -> List[dict]:
        """Convert LangChain tools to DMR-X tool format."""
        converted = []
        for tool in tools:
            if isinstance(tool, type) and issubclass(tool, BaseModel):
                schema = tool.model_json_schema()
                converted.append({
                    "type": "function",
                    "function": {
                        "name": schema.get("title", tool.__name__),
                        "description": schema.get("description", ""),
                        "parameters": schema,
                    },
                })
            elif isinstance(tool, BaseTool):
                converted.append({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description or "",
                        "parameters": tool.args_schema.model_json_schema()
                        if tool.args_schema
                        else {"type": "object", "properties": {}},
                    },
                })
            elif isinstance(tool, dict):
                converted.append(tool)
        return converted

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> LLMResult:
        """Generate a chat response."""
        dmrx_messages = self._convert_messages_to_dicts(messages)
        request_kwargs = self._build_request_kwargs(**kwargs)

        response = self._client.chat.completions.create(
            messages=dmrx_messages,
            stop=stop,
            **request_kwargs,
        )

        dmrx_message = response.choices[0].message

        lc_message = _convert_dmrx_message_to_lc({
            "content": dmrx_message.content,
            "tool_calls": dmrx_message.tool_calls or [],
            "provider": getattr(response, "provider", None),
            "latency_ms": getattr(response, "latency_ms", None),
        })

        generation = ChatGeneration(message=lc_message)
        return LLMResult(generations=[[generation]])

    async def _agenerate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[AsyncCallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> LLMResult:
        """Generate a chat response asynchronously."""
        return await run_in_executor(
            None, self._generate, messages, stop, None, **kwargs
        )

    def _stream(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        """Stream a chat response."""
        dmrx_messages = self._convert_messages_to_dicts(messages)
        request_kwargs = self._build_request_kwargs(**kwargs)

        stream = self._client.chat.completions.create(
            messages=dmrx_messages,
            stop=stop,
            stream=True,
            **request_kwargs,
        )

        for chunk in stream:
            if chunk.type == "token":
                content = chunk.data.get("content", "")
                if content:
                    chunk_gen = ChatGenerationChunk(
                        message=AIMessageChunk(content=content)
                    )
                    if run_manager:
                        run_manager.on_llm_new_token(content, chunk=chunk_gen)
                    yield chunk_gen

            elif chunk.type == "done":
                return

    async def _astream(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Optional[AsyncCallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        """Stream a chat response asynchronously."""
        for chunk in self._stream(messages, stop, None, **kwargs):
            yield chunk

    def bind_tools(
        self,
        tools: Sequence[Union[Dict[str, Any], Type[BaseModel], BaseTool]],
        **kwargs: Any,
    ) -> "ChatDMRX":
        """Bind tools to the model (LangChain pattern)."""
        return self.bind(tools=tools, **kwargs)

    def get_num_tokens(self, text: str) -> int:
        """Get the number of tokens in a text string."""
        return len(text) // 4
