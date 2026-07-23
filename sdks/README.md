# DMR-X SDKs

Official SDKs for interacting with the [DMR-X](https://dmr-x.io) universal AI routing and orchestration gateway.

## Available SDKs

| SDK | Language | Package | Status | Docs |
|-----|----------|---------|--------|------|
| Python | Python ≥3.10 | `dmrx` ([PyPI](https://pypi.org/project/dmrx/)) | ✅ Stable | [README](python/README.md) |
| Go | Go 1.22+ | `github.com/dmr-x/dmr-x/sdks/go` | ✅ Stable | [README](go/README.md) |

## Quick Comparison

| Feature | Python SDK | Go SDK |
|---------|-----------|--------|
| Sync client | `DMRXClient` | `Client` (blocking) |
| Async client | `AsyncDMRXClient` | `Client` with `context.Context` |
| Streaming | `Stream` / `AsyncStream` iterators | Channel-based (`<-chan StreamChunk`) |
| Type system | Pydantic v2 | Native Go structs |
| Meta-model aliases | ✅ | ✅ |
| Routing parameters | ✅ | ✅ |
| Error hierarchy | Typed exceptions | Typed error values |
| Installation | `pip install dmrx` | `go get github.com/dmr-x/dmr-x/sdks/go` |

## Endpoint Coverage

| Endpoint | Python | Go |
|----------|--------|----|
| Chat completions | ✅ | ✅ |
| Chat streaming | ✅ | ✅ |
| List models | ✅ | ✅ |
| Retrieve model | ✅ | ✅ |
| Embeddings | ✅ | ✅ |
| Image generation | ✅ | ✅ |
| Text-to-speech | ✅ | ✅ |
| Speech-to-text | ✅ | ✅ |
| Tool execution | ✅ | ✅ |
| Tool loop | ✅ | ✅ |
| Agentic chat | ✅ | ✅ |

## Quick Start

### Python

```python
from dmrx import DMRXClient

client = DMRXClient(api_key="dmrx_...", base_url="http://localhost:3000")
response = client.chat.completions.create(
    model="auto-coding",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

### Go

```go
import "github.com/dmr-x/dmr-x/sdks/go"

client := dmrx.NewClient("dmrx_...", "http://localhost:3000")
resp, _ := client.Chat(&dmrx.ChatCompletionRequest{
    Model:    "auto-coding",
    Messages: []dmrx.Message{{Role: dmrx.RoleUser, Content: "Hello!"}},
})
fmt.Println(resp.Choices[0].Message.Content)
```

## Development

```bash
# Python
cd sdks/python
pip install -e ".[dev]"
python -m pytest tests/ -v

# Go
cd sdks/go
go vet ./...
go test ./... -v

# Lint Python
pip install ruff
ruff check sdks/python/ --select=E,F,W --ignore=E501
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines on adding endpoints, providers, and running tests.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features (observability, guardrails, enterprise).

## License

The DMR-X SDKs (Python and Go) are licensed under the **MIT License**. See `LICENSES.md` in the project root for the full licensing policy.

The DMR-X platform itself is licensed under the **GNU General Public License v2.0** (GPL-2.0).
