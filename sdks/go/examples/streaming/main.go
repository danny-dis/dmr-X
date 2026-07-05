package main

import (
	"encoding/json"
	"fmt"
	"os"

	dmrx "github.com/dmr-x/dmr-x/sdks/go"
)

func main() {
	apiKey := os.Getenv("DMRX_API_KEY")
	if apiKey == "" {
		apiKey = "dmrx_dev_key"
	}
	baseURL := os.Getenv("DMRX_BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:3000"
	}

	client := dmrx.NewClient(apiKey, baseURL)

	req := &dmrx.ChatCompletionRequest{
		Model: "auto",
		Messages: []dmrx.Message{
			{Role: dmrx.RoleUser, Content: "Write a short poem about Go programming."},
		},
		MaxTokens: ptr(200),
	}

	stream, err := client.ChatStream(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	fmt.Print("Streaming: ")
	for chunk := range stream.Iter() {
		switch chunk.Type {
		case dmrx.StreamChunkToken:
			var token dmrx.TokenData
			if err := json.Unmarshal(chunk.Data, &token); err == nil && token.Content != nil {
				fmt.Print(*token.Content)
			}
		case dmrx.StreamChunkDone:
			var done dmrx.DoneData
			json.Unmarshal(chunk.Data, &done)
			fmt.Printf("\n[Finish reason: %s]\n", done.FinishReason)
		case dmrx.StreamChunkError:
			var errData dmrx.ErrorData
			json.Unmarshal(chunk.Data, &errData)
			fmt.Fprintf(os.Stderr, "\nError: [%s] %s\n", errData.Code, errData.Message)
		}
	}
}

func ptr[T any](v T) *T {
	return &v
}
