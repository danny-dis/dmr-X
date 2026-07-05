"""
LlamaIndex integration for DMR-X.

Provides a LlamaIndex LLM wrapper that routes through DMR-X's
intelligent provider selection.

Usage:
    from dmrx.integrations.llama_index import DMRX

    llm = DMRX(model="auto-coding", api_key="dmrx_...")
    resp = llm.complete("Hello!")
    print(resp.text)
"""

from __future__ import annotations

from typing import Any, Optional, Sequence

try:
    from llama_index.core.llms import LLM, ChatMessage, ChatResponse
    from llama_index.core.llms.callbacks import llm_chat_callback, llm_completion_callback
    from llama_index.core.base.llms.types import (
        CompletionResponse,
        LLMMetadata,
        MessageRole,
    )

    HAS_LLAMA_INDEX = True
except ImportError:
    HAS_LLAMA_INDEX = False


if HAS_LLAMA_INDEX:

    class DMRX(LLM):
        """
        LlamaIndex LLM integration for DMR-X.

        Args:
            model: Model name or meta-model alias
            api_key: DMR-X API key
            base_url: DMR-X gateway URL
            temperature: Sampling temperature
            max_tokens: Maximum response tokens
            quality: Routing quality target
            **kwargs: Additional LLM arguments
        """

        model: str = "auto"
        api_key: str = ""
        base_url: str = "http://localhost:3000"
        temperature: Optional[float] = None
        max_tokens: Optional[int] = None
        quality: Optional[str] = None

        @property
        def metadata(self) -> LLMMetadata:
            return LLMMetadata(
                model_name=self.model,
                is_chat_model=True,
                supports_tool_calling=True,
            )

        @llm_chat_callback
        def chat(self, messages: Sequence[ChatMessage], **kwargs: Any) -> ChatResponse:
            from dmrx import DMRXClient

            client = DMRXClient(
                api_key=self.api_key,
                base_url=self.base_url,
            )

            dmrx_messages = [
                {"role": m.role.value, "content": m.content}
                for m in messages
            ]

            response = client.chat.completions.create(
                model=self.model,
                messages=dmrx_messages,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                quality=self.quality,
            )

            return ChatResponse(
                message=ChatMessage(
                    role=MessageRole.ASSISTANT,
                    content=response.choices[0].message.content,
                ),
                raw=response.model_dump(),
            )

        @llm_completion_callback
        def complete(self, prompt: str, **kwargs: Any) -> CompletionResponse:
            return self.chat([ChatMessage(role=MessageRole.USER, content=prompt)])

        async def achat(
            self, messages: Sequence[ChatMessage], **kwargs: Any
        ) -> ChatResponse:
            return self.chat(messages)

        async def acomplete(self, prompt: str, **kwargs: Any) -> CompletionResponse:
            return self.complete(prompt)

else:

    class DMRX:  # type: ignore
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            raise ImportError(
                "LlamaIndex is not installed. Install it with: "
                "pip install llama-index-core"
            )
