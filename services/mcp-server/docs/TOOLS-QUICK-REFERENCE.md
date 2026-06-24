# DMR-X MCP Tools — Quick Reference

This is a quick reference for the new MCP tools added in v0.5.0.

## Tool Search & Discovery

### `dmrx_tool_search`

Find tools using natural language queries.

```json
{
  "query": "generate an image",
  "max_results": 5,
  "modalities": ["diffusion"],
  "include_external": true
}
```

### `dmrx_tool_list`

List all available tools.

```json
{
  "modalities": ["llm", "diffusion"],
  "include_external": true,
  "include_descriptions": true
}
```

---

## Tool Reference

### `dmrx_chat`
- **Purpose**: Chat completions (LLM modality)
- **Key Parameters**: `messages`, `model`, `temperature`, `max_tokens`
- **Example**: Send a chat message

### `dmrx_generate_image`
- **Purpose**: Image generation (diffusion modality)
- **Key Parameters**: `prompt`, `negative_prompt`, `width`, `height`, `steps`
- **Example**: Generate an image from text

### `dmrx_generate_video`
- **Purpose**: Video generation
- **Key Parameters**: `prompt`, `duration`, `fps`, `aspect_ratio`
- **Example**: Generate a video from text

### `dmrx_generate_music`
- **Purpose**: Music generation
- **Key Parameters**: `prompt`, `genre`, `duration_seconds`, `instruments`
- **Example**: Generate music from text

### `dmrx_embed`
- **Purpose**: Text embeddings
- **Key Parameters**: `input`, `model`, `dimensions`
- **Example**: Get embeddings for text

### `dmrx_transcribe`
- **Purpose**: Audio transcription (STT)
- **Key Parameters**: `audio`, `audio_format`, `language`
- **Example**: Transcribe audio to text

### `dmrx_speak`
- **Purpose**: Text-to-speech (TTS)
- **Key Parameters**: `input`, `voice`, `speed`, `format`
- **Example**: Convert text to speech

### `dmrx_rerank`
- **Purpose**: Document reranking
- **Key Parameters**: `query`, `documents`, `top_n`
- **Example**: Rerank documents by relevance

### `dmrx_models`
- **Purpose**: List available models
- **Key Parameters**: `modality`, `provider`
- **Example**: List all LLM models

### `dmrx_status`
- **Purpose**: System status
- **Key Parameters**: None
- **Example**: Check router health

### `dmrx_batch`
- **Purpose**: Execute multiple tool calls
- **Key Parameters**: `tool`, `args`
- **Example**: Execute multiple tools atomically

### `dmrx_workflow`
- **Purpose**: Multi-step workflows
- **Key Parameters**: `steps`, `fail_fast`, `persist`
- **Example**: Execute a workflow with multiple steps

---

## Coding Agent Tools

### `dmrx_read_file`
- **Purpose**: Read file content
- **Key Parameters**: `path`, `offset`, `limit`

### `dmrx_write_file`
- **Purpose**: Write file content
- **Key Parameters**: `path`, `content`

### `dmrx_edit_file`
- **Purpose**: Edit file by replacing text
- **Key Parameters**: `path`, `old_string`, `new_string`

### `dmrx_list_files`
- **Purpose**: List files in directory
- **Key Parameters**: `path`, `pattern`, `recursive`

### `dmrx_bash`
- **Purpose**: Execute shell command
- **Key Parameters**: `command`, `timeout_ms`, `cwd`

### `dmrx_search_files`
- **Purpose**: Search text in files
- **Key Parameters**: `pattern`, `path`, `include`

---

## Context Management

### `dmrx_context_save`
- **Purpose**: Save conversation context
- **Key Parameters**: `messages`, `user`, `ttl`

### `dmrx_context_load`
- **Purpose**: Load saved context
- **Key Parameters**: `context_id`

### `dmrx_context_list`
- **Purpose**: List saved contexts
- **Key Parameters**: `user`, `limit`, `offset`

### `dmrx_context_summarize`
- **Purpose**: Summarize conversation
- **Key Parameters**: `context_id`

### `dmrx_context_compress`
- **Purpose**: Compress conversation
- **Key Parameters**: `context_id`

---

## Streaming Tools

### `dmrx_chat_stream`
- **Purpose**: Streaming chat completion
- **Key Parameters**: Same as `dmrx_chat`

### `dmrx_generate_image_stream`
- **Purpose**: Streaming image generation
- **Key Parameters**: Same as `dmrx_generate_image`

### `dmrx_generate_video_stream`
- **Purpose**: Streaming video generation
- **Key Parameters**: Same as `dmrx_generate_video`

---

## 3D Generation

### `dmrx_generate_3d`
- **Purpose**: Generate 3D models
- **Key Parameters**: `prompt`, `image`, `texture_resolution`, `seed`

---

## Tips

1. **Use Tool Search**: When you're not sure which tool to use, try `dmrx_tool_search` with a natural language description

2. **Filter by Modality**: Use `modalities` parameter to narrow down results to specific types of tools

3. **Include External Tools**: Set `include_external: true` to search across all connected MCP servers

4. **Batch Operations**: Use `dmrx_batch` to execute multiple tools atomically

5. **Workflows**: Use `dmrx_workflow` for complex multi-step operations