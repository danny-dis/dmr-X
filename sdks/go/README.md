# DMR-X Go SDK

[![Go Reference](https://pkg.go.dev/badge/github.com/dmr-x/dmr-x/sdks/go.svg)](https://pkg.go.dev/github.com/dmr-x/dmr-x/sdks/go)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Go SDK for [DMR-X](https://dmr-x.io) — the universal AI routing and orchestration platform.

## Installation

```bash
go get github.com/dmr-x/dmr-x/sdks/go
```

## Quick Start

```go
package main

import (
    "fmt"
    "github.com/dmr-x/dmr-x/sdks/go"
)

func main() {
    client := dmrx.NewClient("dmrx_...", "http://localhost:3000")

    resp, err := client.Chat(&dmrx.ChatCompletionRequest{
        Model: "auto-coding",
        Messages: []dmrx.Message{
            {Role: dmrx.RoleUser, Content: "Write a Go function to reverse a string"},
        },
    })
    if err != nil {
        panic(err)
    }
    fmt.Println(resp.Choices[0].Message.Content)
}
```

## Streaming

```go
stream, err := client.ChatStream(&dmrx.ChatCompletionRequest{
    Model:    "auto",
    Messages: []dmrx.Message{{Role: dmrx.RoleUser, Content: "Write a poem"}},
    Stream:   true,
})
if err != nil {
    panic(err)
}

for chunk := range stream.Iter() {
    if chunk.Type == dmrx.StreamChunkToken {
        var token dmrx.TokenData
        json.Unmarshal(chunk.Data, &token)
        if token.Content != nil {
            fmt.Print(*token.Content)
        }
    }
}
```

## Features

- **Channel-based streaming** — idiomatic Go `<-chan StreamChunk` pattern
- **Context-ready** — all methods accept `context.Context` (customizable via `WithTimeout`)
- **Meta-model aliases** — `auto`, `auto-fast`, `auto-smart`, `auto-agentic`, `auto-coding`
- **Type-safe** — full Go struct definitions for all request/response types
- **Error hierarchy** — typed error values for every DMR-X error code

## API Reference

### Chat Completion

```go
resp, err := client.Chat(&dmrx.ChatCompletionRequest{
    Model:    "auto-coding",
    Messages: []dmrx.Message{{Role: dmrx.RoleUser, Content: "Hello"}},
    Temperature: ptr(0.7),
    MaxTokens:   ptr(1024),
})
```

### List Models

```go
models, err := client.ListModels()
if err != nil {
    panic(err)
}
for _, m := range models.Data {
    fmt.Printf("%s (by %s)\n", m.ID, m.OwnedBy)
}
```

### Embeddings

```go
resp, err := client.CreateEmbedding(&dmrx.EmbeddingRequest{
    Model: "auto",
    Input: []string{"Hello world"},
})
```

### Image Generation

```go
resp, err := client.GenerateImage(&dmrx.ImageGenerationRequest{
    Prompt: "A beautiful sunset over mountains",
    Model:  "auto",
    Size:   "1024x1024",
})
```

### Audio

```go
// Text-to-Speech
speech, err := client.AudioSpeech(&dmrx.AudioSpeechRequest{
    Input: "Hello, world!",
    Voice: "alloy",
})
os.WriteFile("output.mp3", speech.Data, 0644)

// Speech-to-Text
transcript, err := client.TranscribeAudio(&dmrx.AudioTranscriptionRequest{
    Audio: base64String,
})
fmt.Println(transcript.Text)
```

## Error Handling

```go
resp, err := client.Chat(&dmrx.ChatCompletionRequest{...})
if err != nil {
    switch e := err.(type) {
    case *dmrx.AuthenticationError:
        log.Fatal("Invalid API key")
    case *dmrx.RateLimitError:
        log.Printf("Rate limited, retry after %dms", e.RetryAfterMs)
    case *dmrx.QuotaExhaustedError:
        log.Fatal("Quota exhausted")
    case *dmrx.ProviderUnavailableError:
        log.Printf("Providers unavailable, retry after %ds", e.RetryAfter)
    case *dmrx.DMRXError:
        log.Printf("DMR-X error [%s]: %s", e.Code, e.Message)
    }
}
```

## Type Definitions

The canonical TypeScript type definitions for DMR-X are published under MIT
license in the `packages/types/` directory — see
[`@dmr-x/types`](https://github.com/dmr-x/dmr-x/tree/main/packages/types).
All SDK types are derived from these definitions, which serve as the
single source of truth for the DMR-X public API contract.

## License

MIT — same as the DMR-X core SDK packages. The DMR-X platform itself is licensed under GPL-2.0.
