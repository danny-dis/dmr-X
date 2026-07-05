package dmrx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func setupTestServer(response interface{}, statusCode int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(statusCode)
		if response != nil {
			json.NewEncoder(w).Encode(response)
		}
	}))
}

func TestChatCompletion(t *testing.T) {
	mockResp := ChatCompletionResponse{
		ID:      "test-id",
		Object:  "chat.completion",
		Created: 1000000,
		Model:   "gpt-4o",
		Choices: []ChatCompletionChoice{
			{
				Index: 0,
				Message: Message{
					Role:    RoleAssistant,
					Content: "Hello, world!",
				},
				FinishReason: "stop",
			},
		},
		Usage: &TokenUsage{
			PromptTokens:     10,
			CompletionTokens: 20,
			TotalTokens:      30,
		},
	}

	server := setupTestServer(mockResp, 200)
	defer server.Close()

	client := NewClient("test-key", server.URL)
	resp, err := client.Chat(&ChatCompletionRequest{
		Model: "auto-coding",
		Messages: []Message{
			{Role: RoleUser, Content: "Hello!"},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.ID != "test-id" {
		t.Errorf("expected ID test-id, got %s", resp.ID)
	}
	if len(resp.Choices) != 1 {
		t.Errorf("expected 1 choice, got %d", len(resp.Choices))
	}
	if resp.Choices[0].Message.Content != "Hello, world!" {
		t.Errorf("expected 'Hello, world!', got '%v'", resp.Choices[0].Message.Content)
	}
}

func TestListModels(t *testing.T) {
	mockResp := ModelList{
		Object: "list",
		Data: []Model{
			{
				ID:      "gpt-4o",
				Object:  "model",
				Created: 1000000,
				OwnedBy: "openai",
			},
			{
				ID:      "claude-sonnet-4-0520",
				Object:  "model",
				Created: 1000000,
				OwnedBy: "anthropic",
			},
		},
	}

	server := setupTestServer(mockResp, 200)
	defer server.Close()

	client := NewClient("test-key", server.URL)
	resp, err := client.ListModels()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Data) != 2 {
		t.Errorf("expected 2 models, got %d", len(resp.Data))
	}
}

func TestAuthenticationError(t *testing.T) {
	server := setupTestServer(map[string]interface{}{
		"code":    "AUTHENTICATION_ERROR",
		"message": "Invalid API key",
	}, 401)
	defer server.Close()

	client := NewClient("bad-key", server.URL)
	_, err := client.Chat(&ChatCompletionRequest{
		Model: "auto",
		Messages: []Message{
			{Role: RoleUser, Content: "Hello"},
		},
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	authErr, ok := err.(*AuthenticationError)
	if !ok {
		t.Fatalf("expected AuthenticationError, got %T: %v", err, err)
	}
	if authErr.StatusCode != 401 {
		t.Errorf("expected status 401, got %d", authErr.StatusCode)
	}
}

func TestProviderError(t *testing.T) {
	server := setupTestServer(map[string]interface{}{
		"code":    "PROVIDER_ERROR",
		"message": "Upstream timeout",
		"details": map[string]interface{}{
			"provider_id": "openai",
		},
	}, 502)
	defer server.Close()

	client := NewClient("test-key", server.URL)
	_, err := client.Chat(&ChatCompletionRequest{
		Model: "auto",
		Messages: []Message{
			{Role: RoleUser, Content: "Hello"},
		},
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	provErr, ok := err.(*ProviderError)
	if !ok {
		t.Fatalf("expected ProviderError, got %T: %v", err, err)
	}
	if provErr.ProviderID != "openai" {
		t.Errorf("expected provider openai, got %s", provErr.ProviderID)
	}
}

func TestGenerateVideo(t *testing.T) {
	mockResp := VideoGenerationResponse{
		Created: 1000000,
		Data: []GeneratedVideo{
			{
				URL:        "http://example.com/video.mp4",
				Duration:   10.0,
				FPS:        24,
				Resolution: "1080p",
			},
		},
	}

	server := setupTestServer(mockResp, 200)
	defer server.Close()

	client := NewClient("test-key", server.URL)
	resp, err := client.GenerateVideo(&VideoGenerationRequest{
		Model:  "auto-video",
		Prompt: "A cat walking",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Data) != 1 {
		t.Errorf("expected 1 video, got %d", len(resp.Data))
	}
	if resp.Data[0].URL != "http://example.com/video.mp4" {
		t.Errorf("expected video URL, got %s", resp.Data[0].URL)
	}
}

func TestAudioSpeech(t *testing.T) {
	audioData := []byte("fake-audio-data")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/mpeg")
		w.WriteHeader(200)
		w.Write(audioData)
	}))
	defer server.Close()

	client := NewClient("test-key", server.URL)
	resp, err := client.AudioSpeech(&AudioSpeechRequest{
		Model: "auto-tts",
		Input: "Hello world",
		Voice: "alloy",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Data) == 0 {
		t.Errorf("expected audio data, got empty")
	}
}

func TestRateLimitRetry(t *testing.T) {
	var attempts int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			w.WriteHeader(429)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"code":    "RATE_LIMIT_ERROR",
				"message": "Rate limit exceeded",
			})
			return
		}
		json.NewEncoder(w).Encode(ModerationResponse{
			ID:    "mod-test-id",
			Model: "moderation-latest",
			Results: []ModerationResult{
				{Flagged: false},
			},
		})
	}))
	defer server.Close()

	client := NewClient("test-key", server.URL)
	client.MaxRetries = 1
	client.HTTPClient.Timeout = 5 * time.Second

	resp, err := client.Moderate(&ModerationRequest{
		Model: "moderation-latest",
		Input: "Hello world",
	})
	if err != nil {
		t.Fatalf("unexpected error after retry: %v", err)
	}
	if len(resp.Results) != 1 {
		t.Errorf("expected 1 result, got %d", len(resp.Results))
	}
	if attempts != 2 {
		t.Errorf("expected 2 attempts (1 retry), got %d", attempts)
	}
}

func TestCreateEmbedding(t *testing.T) {
	mockResp := EmbeddingResponse{
		Object: "list",
		Data: []EmbeddingData{
			{
				Index:     0,
				Embedding: []float64{0.1, 0.2, 0.3},
				Object:    "embedding",
			},
		},
		Model: "text-embedding-3-small",
		Usage: EmbeddingUsage{
			PromptTokens: 5,
			TotalTokens:  5,
		},
	}

	server := setupTestServer(mockResp, 200)
	defer server.Close()

	client := NewClient("test-key", server.URL)
	resp, err := client.CreateEmbedding(&EmbeddingRequest{
		Model: "auto",
		Input: []string{"Hello world"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Data) != 1 {
		t.Errorf("expected 1 embedding, got %d", len(resp.Data))
	}
}
