"""
DMR-X API error types.
Mirrors packages/core/src/types/errors.ts from the DMR-X monorepo.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


class DMRXError(Exception):
    """Base exception for all DMR-X API errors."""

    def __init__(
        self,
        message: str,
        code: str = "UNKNOWN_ERROR",
        status_code: int = 500,
        is_retryable: bool = False,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.code = code
        self.status_code = status_code
        self.is_retryable = is_retryable
        self.details = details or {}
        super().__init__(message)

    def __str__(self) -> str:
        return f"[{self.code}] {self.args[0]}"


class ValidationError(DMRXError):
    """Request validation failed (HTTP 400)."""

    def __init__(
        self,
        message: str = "Validation error",
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message, "VALIDATION_ERROR", 400, False, details)


class AuthenticationError(DMRXError):
    """Invalid or missing API key (HTTP 401)."""

    def __init__(self, message: str = "Invalid API key") -> None:
        super().__init__(message, "AUTHENTICATION_ERROR", 401, False)


class RateLimitError(DMRXError):
    """Rate limit exceeded (HTTP 429)."""

    def __init__(self, retry_after_ms: int = 1000) -> None:
        super().__init__(
            "Rate limit exceeded",
            "RATE_LIMIT_ERROR",
            429,
            True,
            {"retry_after_ms": retry_after_ms},
        )


class QuotaExhaustedError(DMRXError):
    """Tenant quota exhausted (HTTP 402)."""

    def __init__(self) -> None:
        super().__init__("Quota exhausted", "QUOTA_EXHAUSTED", 402, False)


class ProviderError(DMRXError):
    """Upstream provider returned an error (HTTP 502)."""

    def __init__(
        self,
        message: str = "Provider error",
        provider_id: str = "unknown",
        status_code: int = 502,
    ) -> None:
        self.provider_id = provider_id
        super().__init__(message, "PROVIDER_ERROR", status_code, True, {"provider_id": provider_id})


class AllProvidersFailedError(DMRXError):
    """All providers in the fallback chain failed (HTTP 502)."""

    def __init__(self, providers_tried: List[str]) -> None:
        self.providers_tried = providers_tried
        super().__init__(
            "All providers failed",
            "ALL_PROVIDERS_FAILED",
            502,
            False,
            {"providers_tried": providers_tried},
        )


class ProviderUnavailableError(DMRXError):
    """No providers are currently available (HTTP 503)."""

    def __init__(
        self,
        providers_tried: List[str],
        retry_after: int = 30,
    ) -> None:
        self.providers_tried = providers_tried
        self.retry_after = retry_after
        super().__init__(
            "All providers currently unavailable",
            "PROVIDER_UNAVAILABLE",
            503,
            True,
            {"providers_tried": providers_tried, "retry_after": retry_after},
        )


# ── Error mapping ────────────────────────────────────────────────

_ERROR_CODE_MAP: Dict[str, type[DMRXError]] = {
    "VALIDATION_ERROR": ValidationError,
    "AUTHENTICATION_ERROR": AuthenticationError,
    "RATE_LIMIT_ERROR": RateLimitError,
    "QUOTA_EXHAUSTED": QuotaExhaustedError,
    "PROVIDER_ERROR": ProviderError,
    "ALL_PROVIDERS_FAILED": AllProvidersFailedError,
    "PROVIDER_UNAVAILABLE": ProviderUnavailableError,
}


def map_error(status_code: int, body: Optional[Dict[str, Any]] = None) -> DMRXError:
    """Map an HTTP response to a DMRXError subclass."""
    body = body or {}

    code = body.get("code", "")
    message = body.get("message", "Unknown error")
    details = body.get("details", {})

    # Status-code-based fallbacks
    if status_code == 400:
        return ValidationError(message, details)
    elif status_code == 401:
        return AuthenticationError(message)
    elif status_code == 402:
        return QuotaExhaustedError()
    elif status_code == 429:
        retry_after = details.get("retry_after_ms", 1000)
        return RateLimitError(retry_after)

    # Code-based matching
    cls = _ERROR_CODE_MAP.get(code)
    if cls is not None:
        if cls == AllProvidersFailedError:
            return cls(providers_tried=details.get("providers_tried", []))
        elif cls == ProviderUnavailableError:
            return cls(
                providers_tried=details.get("providers_tried", []),
                retry_after=details.get("retry_after", 30),
            )
        elif cls == ProviderError:
            return cls(
                message=message,
                provider_id=details.get("provider_id", "unknown"),
                status_code=status_code,
            )
        return cls(message)

    return DMRXError(message, code, status_code, status_code >= 500, details)
