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

	fmt.Println("=== DMR-X Go SDK Demo ===")
	fmt.Printf("Gateway: %s\n\n", baseURL)

	// 1. Basic chat completion
	fmt.Println("1. Basic Chat Completion:")
	resp, err := client.Chat(&dmrx.ChatCompletionRequest{
		Model: "auto-coding",
		Messages: []dmrx.Message{
			{Role: dmrx.RoleUser, Content: "Write a one-line Go joke."},
		},
		MaxTokens: ptr(100),
	})
	if err != nil {
		fmt.Printf("  Error: %v\n", err)
	} else {
		fmt.Printf("  Model: %s\n", resp.Model)
		fmt.Printf("  Reply: %s\n", resp.Choices[0].Message.Content)
		if resp.Usage != nil {
			fmt.Printf("  Tokens: %d\n", resp.Usage.TotalTokens)
		}
	}

	// 2. Streaming
	fmt.Println("\n2. Streaming Chat:")
	stream, err := client.ChatStream(&dmrx.ChatCompletionRequest{
		Model: "auto",
		Messages: []dmrx.Message{
			{Role: dmrx.RoleUser, Content: "Count from 1 to 5."},
		},
		MaxTokens: ptr(200),
	})
	if err != nil {
		fmt.Printf("  Error: %v\n", err)
	} else {
		fmt.Print("  Stream: ")
		for chunk := range stream.Iter() {
			if chunk.Type == dmrx.StreamChunkToken {
				var token dmrx.TokenData
				if err := json.Unmarshal(chunk.Data, &token); err == nil && token.Content != nil {
					fmt.Print(*token.Content)
				}
			}
		}
		fmt.Println()
	}

	// 3. Meta-model aliases
	fmt.Println("\n3. Meta-Model Aliases:")
	for _, alias := range []string{"auto-fast", "auto-smart", "auto-agentic", "auto-coding"} {
		resp, err := client.Chat(&dmrx.ChatCompletionRequest{
			Model:    alias,
			Messages: []dmrx.Message{{Role: dmrx.RoleUser, Content: "Say 'ok'"}},
			MaxTokens: ptr(10),
		})
		if err != nil {
			fmt.Printf("  %-15s -> ERROR: %v\n", alias, err)
		} else {
			fmt.Printf("  %-15s -> %s\n", alias, resp.Model)
		}
	}

	// 4. List models
	fmt.Println("\n4. Available Models:")
	models, err := client.ListModels()
	if err != nil {
		fmt.Printf("  Error: %v\n", err)
	} else {
		count := min(5, len(models.Data))
		for _, m := range models.Data[:count] {
			fmt.Printf("  %-40s (by %s)\n", m.ID, m.OwnedBy)
		}
		if len(models.Data) > count {
			fmt.Printf("  ... and %d more\n", len(models.Data)-count)
		}
	}

	fmt.Println("\n✅ Demo complete!")
}

func ptr[T any](v T) *T {
	return &v
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
