package dmrx

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// Stream provides channel-based access to streaming response chunks.
type Stream struct {
	ch     chan StreamChunk
	errCh  chan error
	doneCh chan struct{}
}

// Ch returns a read-only channel of stream chunks.
func (s *Stream) Ch() <-chan StreamChunk {
	return s.ch
}

// Err returns a read-only channel for stream errors.
func (s *Stream) Err() <-chan error {
	return s.errCh
}

// Done returns a channel that closes when the stream is complete.
func (s *Stream) Done() <-chan struct{} {
	return s.doneCh
}

// Iter returns a channel for range-based iteration over stream chunks.
func (s *Stream) Iter() <-chan StreamChunk {
	return s.ch
}

// parseSSELine parses a single SSE line into a key-value pair.
func parseSSELine(line string) (string, string, bool) {
	line = strings.TrimSpace(line)
	if line == "" {
		return "", "", false
	}
	if idx := strings.Index(line, ":"); idx >= 0 {
		key := strings.TrimSpace(line[:idx])
		value := strings.TrimSpace(line[idx+1:])
		return key, value, true
	}
	return "", "", false
}

// parseStreamEvent parses an SSE data payload into a StreamChunk.
func parseStreamEvent(dataStr string) (*StreamChunk, error) {
	// Handle OpenAI end marker
	if dataStr == "[DONE]" {
		return &StreamChunk{
			Type:  StreamChunkDone,
			Data:  nil,
			Index: 0,
		}, nil
	}

	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(dataStr), &raw); err != nil {
		return nil, fmt.Errorf("failed to parse stream event: %w", err)
	}

	// DMR-X native streaming format
	if chunkType, ok := raw["type"].(string); ok {
		chunkData, _ := json.Marshal(raw["data"])
		index := 0
		if idx, ok := raw["index"].(float64); ok {
			index = int(idx)
		}

		return &StreamChunk{
			Type:  StreamChunkType(chunkType),
			Data:  chunkData,
			Index: index,
		}, nil
	}

	// OpenAI-compatible streaming format
	if obj, ok := raw["object"].(string); ok && obj == "chat.completion.chunk" {
		choices, _ := raw["choices"].([]interface{})
		if len(choices) > 0 {
			choice, _ := choices[0].(map[string]interface{})

			// Check for finish reason (stream done)
			if finishReason, ok := choice["finish_reason"].(string); ok && finishReason != "" {
				doneData := DoneData{
					RequestID:    getString(raw, "id"),
					ModelID:      getString(raw, "model"),
					FinishReason: finishReason,
				}
				dataBytes, _ := json.Marshal(doneData)
				return &StreamChunk{
					Type:  StreamChunkDone,
					Data:  dataBytes,
					Index: 0,
				}, nil
			}

			// Token delta
			delta, _ := choice["delta"].(map[string]interface{})
			tokenData := TokenData{}
			if content, ok := delta["content"].(string); ok {
				tokenData.Content = &content
			}
			if tc, ok := delta["tool_calls"].([]interface{}); ok {
				tcBytes, _ := json.Marshal(tc)
				json.Unmarshal(tcBytes, &tokenData.ToolCalls)
			}
			if role, ok := delta["role"].(string); ok {
				tokenData.Role = role
			}

			dataBytes, _ := json.Marshal(tokenData)
			return &StreamChunk{
				Type:  StreamChunkToken,
				Data:  dataBytes,
				Index: 0,
			}, nil
		}
	}

	return nil, fmt.Errorf("unknown stream format: %s", dataStr)
}

// readStream reads SSE lines and sends parsed chunks to the channel.
func readStream(reader io.Reader, stream *Stream) {
	defer close(stream.doneCh)
	defer close(stream.ch)

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var dataBuffer string

	for scanner.Scan() {
		line := scanner.Text()

		// Skip empty lines (SSE message separators)
		if line == "" {
			if dataBuffer != "" {
				chunk, err := parseStreamEvent(dataBuffer)
				if err != nil {
					stream.errCh <- err
					return
				}
				if chunk.Type == StreamChunkDone && chunk.Data == nil {
					// [DONE] marker
					return
				}
				stream.ch <- *chunk
				dataBuffer = ""
			}
			continue
		}

		// Parse SSE field
		key, value, ok := parseSSELine(line)
		if !ok {
			continue
		}

		switch key {
		case "event":
			// Skip event type lines
		case "data":
			dataBuffer = value
		case ":":
			// SSE comment, skip
		}
	}

	// Handle trailing data
	if dataBuffer != "" {
		chunk, err := parseStreamEvent(dataBuffer)
		if err == nil {
			if !(chunk.Type == StreamChunkDone && chunk.Data == nil) {
				stream.ch <- *chunk
			}
		}
	}

	if err := scanner.Err(); err != nil {
		select {
		case stream.errCh <- fmt.Errorf("stream scanner error: %w", err):
		default:
		}
	}
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func getFloat(m map[string]interface{}, key string) float64 {
	if v, ok := m[key].(float64); ok {
		return v
	}
	return 0
}
