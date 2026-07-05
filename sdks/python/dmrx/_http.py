"""
Low-level HTTP transport for the DMR-X Python SDK.
Provides both sync and async HTTP clients using httpx.
"""

from __future__ import annotations

import asyncio
import json
import random
import time
from typing import Any, AsyncIterator, Dict, Iterator, Optional

import httpx

from .errors import DMRXError, map_error


class HTTPTransport:
    """
    HTTP transport layer for DMR-X API calls.

    Handles request sending, response parsing, error mapping,
    and streaming response handling for both sync and async usage.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 60.0,
        max_retries: int = 0,
        client: Optional[httpx.Client] = None,
        async_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.max_retries = max_retries

        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "dmrx-python/0.1.0",
        }

        self._client = client or httpx.Client(
            timeout=httpx.Timeout(timeout),
            follow_redirects=True,
        )
        self._async_client = async_client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            follow_redirects=True,
        )

    def request(
        self,
        method: str,
        path: str,
        json_body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> httpx.Response:
        """Make a synchronous HTTP request."""
        url = f"{self.base_url}{path}"

        for attempt in range(self.max_retries + 1):
            response = self._client.request(
                method=method,
                url=url,
                headers=self._headers,
                json=json_body,
                params=params,
            )

            if response.is_success:
                return response

            if (response.status_code == 429 or response.status_code >= 500) and attempt < self.max_retries:
                sleep_time = (2 ** attempt) * random.uniform(0.8, 1.2)
                time.sleep(sleep_time)
                continue

            self._raise_on_error(response)

        # Unreachable if _raise_on_error never fires, but satisfy type checker
        raise DMRXError("Request failed after retries", status_code=response.status_code)

    async def async_request(
        self,
        method: str,
        path: str,
        json_body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> httpx.Response:
        """Make an asynchronous HTTP request."""
        url = f"{self.base_url}{path}"

        for attempt in range(self.max_retries + 1):
            response = await self._async_client.request(
                method=method,
                url=url,
                headers=self._headers,
                json=json_body,
                params=params,
            )

            if response.is_success:
                return response

            if (response.status_code == 429 or response.status_code >= 500) and attempt < self.max_retries:
                sleep_time = (2 ** attempt) * random.uniform(0.8, 1.2)
                await asyncio.sleep(sleep_time)
                continue

            self._raise_on_error(response)

        raise DMRXError("Request failed after retries", status_code=response.status_code)

    def stream_lines(self, path: str, json_body: Dict[str, Any]) -> Iterator[str]:
        """
        Synchronous streaming: yield raw text lines from a streaming response.

        The request body MUST have `stream: true`.
        """
        url = f"{self.base_url}{path}"

        with self._client.stream(
            method="POST",
            url=url,
            headers=self._headers,
            json=json_body,
        ) as response:
            if not response.is_success:
                body = b"".join(response.iter_bytes())
                try:
                    json_body_resp = json.loads(body)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    json_body_resp = None
                self._raise_on_error_raw(response.status_code, json_body_resp)

            for line in response.iter_lines():
                yield line

    async def async_stream_lines(
        self,
        path: str,
        json_body: Dict[str, Any],
    ) -> AsyncIterator[str]:
        """
        Asynchronous streaming: yield raw text lines from a streaming response.

        The request body MUST have `stream: true`.
        """
        url = f"{self.base_url}{path}"

        async with self._async_client.stream(
            method="POST",
            url=url,
            headers=self._headers,
            json=json_body,
        ) as response:
            if not response.is_success:
                body = b"".join([chunk async for chunk in response.aiter_bytes()])
                try:
                    json_body_resp = json.loads(body)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    json_body_resp = None
                self._raise_on_error_raw(response.status_code, json_body_resp)

            async for line in response.aiter_lines():
                yield line

    def _raise_on_error(self, response: httpx.Response) -> None:
        """Parse error response and raise appropriate DMRXError."""
        try:
            body = response.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            body = None
        self._raise_on_error_raw(response.status_code, body)

    def _raise_on_error_raw(
        self,
        status_code: int,
        body: Optional[Dict[str, Any]],
    ) -> None:
        """Map HTTP status code + response body to a DMRXError and raise it."""
        raise map_error(status_code, body)

    def close(self) -> None:
        """Close the sync client."""
        self._client.close()

    async def aclose(self) -> None:
        """Close the async client."""
        await self._async_client.aclose()
