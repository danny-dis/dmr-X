package dmrx

// ChatCompletionCreate sends a chat completion request.
// This is a convenience wrapper that delegates to Client.Chat.
//
// Usage:
//
//	resp, err := client.ChatCompletionCreate(ctx, &dmrx.ChatCompletionRequest{
//	    Model:    "auto-coding",
//	    Messages: []dmrx.Message{{Role: dmrx.RoleUser, Content: "Hello!"}},
//	})
func (c *Client) ChatCompletionCreate(req *ChatCompletionRequest) (*ChatCompletionResponse, error) {
	return c.Chat(req)
}

// ChatCompletionCreateStream sends a streaming chat completion request.
// This is a convenience wrapper that delegates to Client.ChatStream.
//
// Usage:
//
//	stream, err := client.ChatCompletionCreateStream(ctx, &dmrx.ChatCompletionRequest{
//	    Model:    "auto",
//	    Messages: []dmrx.Message{{Role: dmrx.RoleUser, Content: "Hello"}},
//	    Stream:   true,
//	})
//	if err != nil { ... }
//	for chunk := range stream.Iter() {
//	    var token dmrx.TokenData
//	    json.Unmarshal(chunk.Data, &token)
//	    if token.Content != nil {
//	        fmt.Print(*token.Content)
//	    }
//	}
func (c *Client) ChatCompletionCreateStream(req *ChatCompletionRequest) (*Stream, error) {
	return c.ChatStream(req)
}
