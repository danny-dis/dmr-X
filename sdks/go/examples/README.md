# DMR-X Go SDK Examples

This directory contains example programs demonstrating the DMR-X Go SDK.

## Prerequisites

- A running DMR-X gateway (default: http://localhost:3000)
- A valid API key

## Running Examples

```bash
# Set your API key
export DMRX_API_KEY=dmrx_...
export DMRX_BASE_URL=http://localhost:3000  # optional, defaults to :3000

# Chat example
go run examples/chat/main.go

# Streaming example
go run examples/streaming/main.go

# Tool calling example
go run examples/tools/main.go
```

## What Each Example Demonstrates

| Example | Features |
|---------|----------|
| `chat/main.go` | Basic chat, streaming, meta-model aliases, model listing |
| `streaming/main.go` | Channel-based streaming with chunk type handling |
| `tools/main.go` | Tool/function calling with structured parameters |
