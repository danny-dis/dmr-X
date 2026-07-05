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

	// Define a weather tool
	weatherTool := dmrx.Tool{
		Type: "function",
		Function: dmrx.ToolDefinition{
			Name:        "get_weather",
			Description: "Get the current weather for a location",
			Parameters: json.RawMessage(`{
				"type": "object",
				"properties": {
					"location": {
						"type": "string",
						"description": "City and state, e.g. San Francisco, CA"
					}
				},
				"required": ["location"]
			}`),
		},
	}

	resp, err := client.Chat(&dmrx.ChatCompletionRequest{
		Model: "auto-agentic",
		Messages: []dmrx.Message{
			{Role: dmrx.RoleUser, Content: "What's the weather in San Francisco?"},
		},
		Tools:    []dmrx.Tool{weatherTool},
		MaxTokens: ptr(500),
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	msg := resp.Choices[0].Message

	if len(msg.ToolCalls) > 0 {
		fmt.Println("Model requested tool calls:")
		for _, tc := range msg.ToolCalls {
			fmt.Printf("  - %s(%s)\n", tc.Function.Name, tc.Function.Arguments)
		}
	} else {
		fmt.Printf("Response: %v\n", msg.Content)
	}
}

func ptr[T any](v T) *T {
	return &v
}
