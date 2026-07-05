package dmrx

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"time"
)

// Client is the DMR-X API client.
//
// Usage:
//
//	client := dmrx.NewClient("dmrx_...", "http://localhost:3000")
//
//	// Chat completion
//	resp, err := client.Chat(ctx, &dmrx.ChatCompletionRequest{
//	    Model:    "auto-coding",
//	    Messages: []dmrx.Message{{Role: dmrx.RoleUser, Content: "Hello!"}},
//	})
//
//	// Streaming
//	stream, err := client.ChatStream(ctx, &dmrx.ChatCompletionRequest{
//	    Model:    "auto",
//	    Messages: []dmrx.Message{{Role: dmrx.RoleUser, Content: "Write a poem"}},
//	    Stream:   true,
//	})
//	for chunk := range stream.Iter() { ... }
type Client struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
	UserAgent  string
	MaxRetries int
}

// ClientOption configures the DMR-X client.
type ClientOption func(*Client)

// WithHTTPClient sets a custom HTTP client.
func WithHTTPClient(httpClient *http.Client) ClientOption {
	return func(c *Client) {
		c.HTTPClient = httpClient
	}
}

// WithTimeout sets the HTTP client timeout.
func WithTimeout(timeout time.Duration) ClientOption {
	return func(c *Client) {
		c.HTTPClient.Timeout = timeout
	}
}

// WithUserAgent sets a custom User-Agent header.
func WithUserAgent(ua string) ClientOption {
	return func(c *Client) {
		c.UserAgent = ua
	}
}

// NewClient creates a new DMR-X API client.
//
//	apiKey: DMR-X API key (starts with "dmrx_")
//	baseURL: DMR-X gateway URL (default: "http://localhost:3000")
//
// Usage:
//
//	client := dmrx.NewClient("dmrx_abc123", "http://localhost:3000")
func NewClient(apiKey string, baseURL string, opts ...ClientOption) *Client {
	c := &Client{
		BaseURL:   baseURL,
		APIKey:    apiKey,
		HTTPClient: &http.Client{
			Timeout: 60 * time.Second,
		},
		UserAgent: "dmrx-go/0.1.0",
	}

	for _, opt := range opts {
		opt(c)
	}

	return c
}

// buildURL constructs the full URL for a given API path.
func (c *Client) buildURL(path string) string {
	base := c.BaseURL
	if base == "" {
		base = "http://localhost:3000"
	}
	return fmt.Sprintf("%s%s", base, path)
}

// headers returns the default request headers.
func (c *Client) headers() http.Header {
	h := http.Header{}
	h.Set("Authorization", fmt.Sprintf("Bearer %s", c.APIKey))
	h.Set("Content-Type", "application/json")
	h.Set("User-Agent", c.UserAgent)
	return h
}

// doRequestWithRetry performs an HTTP request with retry logic for transient errors.
// Retries on 429 and 5xx status codes using exponential backoff (1s, 2s, 4s) with jitter.
func (c *Client) doRequestWithRetry(method, path string, body interface{}, target interface{}) error {
	maxRetries := c.MaxRetries
	if maxRetries < 0 {
		maxRetries = 0
	}

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			wait := time.Duration(1<<uint(attempt-1)) * time.Second
			jitter := time.Duration(float64(wait) * (0.5 + float64(rand.Intn(50))/100.0))
			time.Sleep(jitter)
		}

		var attemptBody io.Reader
		if body != nil {
			bodyBytes, err := json.Marshal(body)
			if err != nil {
				return fmt.Errorf("failed to marshal request body: %w", err)
			}
			attemptBody = bytes.NewReader(bodyBytes)
		}

		req, err := http.NewRequest(method, c.buildURL(path), attemptBody)
		if err != nil {
			return fmt.Errorf("failed to create request: %w", err)
		}
		req.Header = c.headers()

		resp, err := c.HTTPClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			continue
		}

		if resp.StatusCode >= 400 {
			errResp := c.handleError(resp)
			resp.Body.Close()
			if resp.StatusCode == 429 || resp.StatusCode >= 500 {
				lastErr = errResp
				continue
			}
			return errResp
		}

		if target != nil {
			if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
				resp.Body.Close()
				return fmt.Errorf("failed to decode response: %w", err)
			}
		}
		resp.Body.Close()
		return nil
	}

	return lastErr
}

// doRequest performs an HTTP request and decodes the JSON response.
func (c *Client) doRequest(method, path string, body interface{}, target interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		bodyBytes, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(bodyBytes)
	}

	req, err := http.NewRequest(method, c.buildURL(path), bodyReader)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header = c.headers()

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return c.handleError(resp)
	}

	if target != nil {
		if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
			return fmt.Errorf("failed to decode response: %w", err)
		}
	}

	return nil
}

// doStreamRequest performs an HTTP request and returns a streaming response reader.
func (c *Client) doStreamRequest(method, path string, body interface{}) (io.ReadCloser, error) {
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request body: %w", err)
	}

	req, err := http.NewRequest(method, c.buildURL(path), bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to create stream request: %w", err)
	}
	req.Header = c.headers()

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("stream request failed: %w", err)
	}

	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		return nil, c.handleError(resp)
	}

	return resp.Body, nil
}

// handleError reads an error response and returns an appropriate DMRXError.
func (c *Client) handleError(resp *http.Response) error {
	var body map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		body = map[string]interface{}{
			"message": fmt.Sprintf("HTTP %d", resp.StatusCode),
		}
	}
	return newError(resp.StatusCode, body)
}

// Chat sends a chat completion request and returns the response.
func (c *Client) Chat(req *ChatCompletionRequest) (*ChatCompletionResponse, error) {
	if req.Stream {
		return nil, fmt.Errorf("dmrx: use ChatStream for streaming requests")
	}

	var resp ChatCompletionResponse
	if err := c.doRequest("POST", "/v1/chat/completions", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ChatStream sends a streaming chat completion request and returns a Stream.
// The request must have Stream: true.
func (c *Client) ChatStream(req *ChatCompletionRequest) (*Stream, error) {
	if !req.Stream {
		reqCopy := *req
		reqCopy.Stream = true
		req = &reqCopy
	}

	reader, err := c.doStreamRequest("POST", "/v1/chat/completions", req)
	if err != nil {
		return nil, err
	}

	stream := &Stream{
		ch:     make(chan StreamChunk, 64),
		errCh:  make(chan error, 1),
		doneCh: make(chan struct{}),
	}

	go readStream(reader, stream)

	return stream, nil
}

// ListModels returns all available models.
func (c *Client) ListModels() (*ModelList, error) {
	var resp ModelList
	if err := c.doRequest("GET", "/v1/models", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetModel returns a single model by ID.
func (c *Client) GetModel(modelID string) (*Model, error) {
	var resp Model
	if err := c.doRequest("GET", fmt.Sprintf("/v1/models/%s", modelID), nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// CreateEmbedding creates embeddings for the given input texts.
func (c *Client) CreateEmbedding(req *EmbeddingRequest) (*EmbeddingResponse, error) {
	var resp EmbeddingResponse
	if err := c.doRequest("POST", "/v1/embeddings", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GenerateImage generates images from a text prompt.
func (c *Client) GenerateImage(req *ImageGenerationRequest) (*ImageGenerationResponse, error) {
	var resp ImageGenerationResponse
	if err := c.doRequest("POST", "/v1/images/generations", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GenerateVideo generates a video from a text prompt.
func (c *Client) GenerateVideo(req *VideoGenerationRequest) (*VideoGenerationResponse, error) {
	var resp VideoGenerationResponse
	if err := c.doRequest("POST", "/v1/video/generations", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// AudioSpeech converts text to speech (TTS).
func (c *Client) AudioSpeech(req *AudioSpeechRequest) (*AudioSpeechResponse, error) {
	resp, err := c.doStreamRequest("POST", "/v1/audio/speech", req)
	if err != nil {
		return nil, err
	}
	defer resp.Close()

	data, err := io.ReadAll(resp)
	if err != nil {
		return nil, fmt.Errorf("failed to read audio response: %w", err)
	}

	return &AudioSpeechResponse{
		ContentType: "audio/mpeg",
		Data:        data,
	}, nil
}

// Moderate performs content moderation on the given input text.
func (c *Client) Moderate(req *ModerationRequest) (*ModerationResponse, error) {
	var resp ModerationResponse
	if err := c.doRequestWithRetry("POST", "/v1/moderations", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// Rerank reranks documents based on relevance to the query.
func (c *Client) Rerank(req *RerankRequest) (*RerankResponse, error) {
	var resp RerankResponse
	if err := c.doRequestWithRetry("POST", "/v1/rerank", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// Ocr performs optical character recognition on an image.
func (c *Client) Ocr(req *OcrRequest) (*OcrResponse, error) {
	var resp OcrResponse
	if err := c.doRequestWithRetry("POST", "/v1/ocr", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// TranscribeAudio transcribes audio to text (STT).
func (c *Client) TranscribeAudio(req *AudioTranscriptionRequest) (*AudioTranscriptionResponse, error) {
	var resp AudioTranscriptionResponse
	if err := c.doRequest("POST", "/v1/audio/transcriptions", req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}
