package dmrx

import (
	"fmt"
)

// DMRXError is the base error type for all DMR-X API errors.
type DMRXError struct {
	Message    string            `json:"message"`
	Code       string            `json:"code"`
	StatusCode int               `json:"status_code"`
	Retryable  bool              `json:"is_retryable"`
	Details    map[string]interface{} `json:"details,omitempty"`
}

func (e *DMRXError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("[%s] %s", e.Code, e.Message)
	}
	return e.Message
}

// ValidationError represents a 400 validation error.
type ValidationError struct {
	DMRXError
}

// AuthenticationError represents a 401 authentication error.
type AuthenticationError struct {
	DMRXError
}

// RateLimitError represents a 429 rate limit error.
type RateLimitError struct {
	DMRXError
	RetryAfterMs int `json:"retry_after_ms"`
}

// QuotaExhaustedError represents a 402 quota exhaustion error.
type QuotaExhaustedError struct {
	DMRXError
}

// ProviderError represents a 502 upstream provider error.
type ProviderError struct {
	DMRXError
	ProviderID string `json:"provider_id"`
}

// AllProvidersFailedError represents all providers in the fallback chain failing.
type AllProvidersFailedError struct {
	DMRXError
	ProvidersTried []string `json:"providers_tried"`
}

// ProviderUnavailableError represents no providers being available (503).
type ProviderUnavailableError struct {
	DMRXError
	ProvidersTried []string `json:"providers_tried"`
	RetryAfter     int      `json:"retry_after"`
}

// newError creates an appropriate DMRXError based on status code and response body.
func newError(statusCode int, body map[string]interface{}) error {
	code, _ := body["code"].(string)
	message, _ := body["message"].(string)
	if message == "" {
		message = fmt.Sprintf("HTTP %d", statusCode)
	}
	details, _ := body["details"].(map[string]interface{})

	switch statusCode {
	case 400:
		return &ValidationError{
			DMRXError: DMRXError{
				Message:    message,
				Code:       code,
				StatusCode: 400,
				Retryable:  false,
				Details:    details,
			},
		}
	case 401:
		return &AuthenticationError{
			DMRXError: DMRXError{
				Message:    message,
				Code:       code,
				StatusCode: 401,
				Retryable:  false,
			},
		}
	case 402:
		return &QuotaExhaustedError{
			DMRXError: DMRXError{
				Message:    "Quota exhausted",
				Code:       "QUOTA_EXHAUSTED",
				StatusCode: 402,
				Retryable:  false,
			},
		}
	case 429:
		retryAfter := 1000
		if details != nil {
			if ra, ok := details["retry_after_ms"].(float64); ok {
				retryAfter = int(ra)
			}
		}
		return &RateLimitError{
			DMRXError: DMRXError{
				Message:    "Rate limit exceeded",
				Code:       "RATE_LIMIT_ERROR",
				StatusCode: 429,
				Retryable:  true,
			},
			RetryAfterMs: retryAfter,
		}
	case 503:
		providersTried := extractStringList(details, "providers_tried")
		retryAfter := 30
		if details != nil {
			if ra, ok := details["retry_after"].(float64); ok {
				retryAfter = int(ra)
			}
		}
		return &ProviderUnavailableError{
			DMRXError: DMRXError{
				Message:    "All providers currently unavailable",
				Code:       "PROVIDER_UNAVAILABLE",
				StatusCode: 503,
				Retryable:  true,
			},
			ProvidersTried: providersTried,
			RetryAfter:     retryAfter,
		}
	}

	// Map by error code
	switch code {
	case "PROVIDER_ERROR":
		providerID := "unknown"
		if details != nil {
			if pid, ok := details["provider_id"].(string); ok {
				providerID = pid
			}
		}
		return &ProviderError{
			DMRXError: DMRXError{
				Message:    message,
				Code:       code,
				StatusCode: statusCode,
				Retryable:  true,
				Details:    details,
			},
			ProviderID: providerID,
		}
	case "ALL_PROVIDERS_FAILED":
		providersTried := extractStringList(details, "providers_tried")
		return &AllProvidersFailedError{
			DMRXError: DMRXError{
				Message:    "All providers failed",
				Code:       code,
				StatusCode: 502,
				Retryable:  false,
			},
			ProvidersTried: providersTried,
		}
	}

	return &DMRXError{
		Message:    message,
		Code:       code,
		StatusCode: statusCode,
		Retryable:  statusCode >= 500,
		Details:    details,
	}
}

// extractStringList safely extracts a []string from a map[key]interface{}.
func extractStringList(m map[string]interface{}, key string) []string {
	if m == nil {
		return nil
	}
	raw, ok := m[key]
	if !ok {
		return nil
	}
	list, ok := raw.([]interface{})
	if !ok {
		return nil
	}
	result := make([]string, len(list))
	for i, v := range list {
		result[i], _ = v.(string)
	}
	return result
}
