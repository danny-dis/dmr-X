# Contributing to DMR-X SDKs

Thank you for your interest in contributing to the DMR-X SDKs! This guide covers the Python and Go SDK packages under `sdks/`.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/dmr-x.git`
3. Create a branch: `git checkout -b sdk/your-feature`
4. Make your changes
5. Run tests (see [Testing](#testing) below)
6. Commit and push
7. Open a pull request against `main`

## How to Add a New Endpoint

### Python SDK

1. **Define the request/response types** in `sdks/python/dmrx/types/` — create a new module (e.g., `rerank.py`) with Pydantic v2 models.
2. **Add the transport method** — add a method to the `_http.py` transport layer if the endpoint needs a new HTTP verb or path pattern.
3. **Expose via the client** — add a property or method to `client.py`. Follow the existing namespace pattern (`client.chat.completions.create`, `client.images.generate`, etc.).
4. **Register exports** — update `dmrx/__init__.py` and `dmrx/types/__init__.py` to re-export new types.
5. **Add tests** — see `sdks/python/tests/test_client.py` for examples.

### Go SDK

1. **Define request/response structs** in `sdks/go/types.go` (or a new file if the types are substantial).
2. **Add the client method** in `sdks/go/client.go` — follow the existing pattern: `func (c *Client) YourEndpoint(ctx context.Context, req *YourRequest) (*YourResponse, error)`.
3. **Add streaming support** (if applicable) in `sdks/go/streaming.go`.
4. **Define error types** (if new error codes are needed) in `sdks/go/errors.go`.
5. **Add tests** — see `sdks/go/dmrx_test.go` for examples.

### Consistency Checklist

- Both SDKs must support the same set of DMR-X routing parameters (`quality`, `provider_preference`, `latency_target`, `cost_target`, etc.)
- Both SDKs must use the same error code values and HTTP status mappings
- Both SDKs must document the new endpoint in their respective README.md

## How to Add a New Provider

Providers are configured on the DMR-X gateway side — the SDKs do not need per-provider code. To expose a provider-specific feature:

1. **Gateway response** handles provider-specific fields in the JSON response — SDKs should pass through unknown fields via `extra_fields` / `additional_properties` rather than blocking.
2. **If a new endpoint** is needed for a provider (e.g., a provider-specific capability), follow the [How to Add a New Endpoint](#how-to-add-a-new-endpoint) guide.
3. **Meta-model aliases** (`auto`, `auto-fast`, `auto-smart`, `auto-agentic`, `auto-coding`) work for all providers — no SDK changes needed.

## Testing

### Python SDK

```bash
cd sdks/python
pip install pytest httpx pydantic pytest-asyncio
python -m pytest tests/ -v
```

Tests use mocked HTTP transports — no running gateway required.

### Go SDK

```bash
cd sdks/go
go vet ./...
go test ./... -v
```

### Before Submitting

- [ ] All tests pass for the SDK(s) you modified
- [ ] Go vet reports no issues (Go SDK changes only)
- [ ] Ruff linter passes (Python SDK changes only):
  ```bash
  pip install ruff
  ruff check sdks/python/ --select=E,F,W --ignore=E501
  ```
- [ ] New types and methods are publicly exported (Python: added to `__init__.py`; Go: capitalized)
- [ ] Both sync and async variants exist for new Python endpoints
- [ ] Streaming is supported if the endpoint supports it
- [ ] README docs updated for the SDK(s) you changed

## PR Checklist

- [ ] Branch name follows conventions: `sdk/<topic>`
- [ ] Tests pass for all affected SDKs
- [ ] Linting passes
- [ ] No generated files committed (`__pycache__/`, `*.pyc`, `vendor/`, `*.test`)
- [ ] README updated if user-facing behavior changed
- [ ] Error types added for any new error codes
- [ ] Streaming support included if applicable
- [ ] All DMR-X routing parameters exposed for new endpoints

## Code Style

### Python

- Follow PEP 8 (enforced by ruff: `E`, `F`, `W` rules)
- Use Pydantic v2 models for all request/response types
- Type hints required for all public methods
- Async methods must return awaitable types

### Go

- Follow `gofmt` / `go vet` conventions
- Use idiomatic Go patterns (`context.Context` first arg, `error` return)
- Channel-based streaming (`<-chan StreamChunk`)
- Pointer types for optional request fields

## License

By contributing, you agree that your contributions will be licensed under the MIT License (same as the SDK packages). See `sdks/.gitignore` and `LICENSES.md` in the project root for details.
