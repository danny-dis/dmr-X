# Dedicated GODMODE API

The dedicated namespace always executes through the managed GODMODE companion and DMR-X provider router. Unlike the standard API's `auto-free` interception, wrapping is required regardless of the requested model alias and the global `DMRX_GODMODE_STRICT` setting. A wrapper failure never silently becomes plain inference.

## Endpoints

- `POST /v1/godmode/chat/completions` — OpenAI Chat Completions format, including streaming and tools.
- `POST /v1/godmode/messages` — Anthropic Messages format, including native streaming and tools.
- `POST /v1/godmode/chat` — retained legacy URL, now using the full OpenAI conversation handler.
- `GET /v1/godmode/health` — companion health.

Existing `/v1/chat/completions`, `/v1/messages`, racing, synthesis, parameter-analysis, transformation and lifecycle endpoints remain separate and retain their current routing behavior.

## OpenAI-compatible clients

Set the base URL to:

```text
http://localhost:47113/v1/godmode
```

The SDK appends `/chat/completions`. For example:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:47113/v1/godmode",
    api_key="<your existing DMR-X API key>",
)
response = client.chat.completions.create(
    model="auto-free",
    messages=[{"role": "user", "content": "What is the capital of Kenya?"}],
    max_completion_tokens=128,
)
print(response.choices[0].message.content)
```

Use the deployment's existing authentication policy. Do not disable authentication or copy a provider/companion key into the client. A placeholder bearer is appropriate only when the operator has explicitly enabled local mode.

## Anthropic-compatible clients

Use the same dedicated base URL: `http://localhost:47113/v1/godmode`.

The Anthropic SDK appends `/v1/messages`. The namespace therefore also registers `/v1/godmode/v1/messages` as a compatibility alias of `/v1/godmode/messages`; both use the identical required-GODMODE handler, including query strings such as `?beta=true`.

```python
from anthropic import Anthropic

client = Anthropic(
    base_url="http://localhost:47113/v1/godmode",
    api_key="<your existing DMR-X API key>",
)
response = client.messages.create(
    model="auto-free",
    max_tokens=128,
    messages=[{"role": "user", "content": "What is the capital of Kenya?"}],
)
```

OpenClaude must use its `custom-anthropic` provider so startup does not replace the custom endpoint. Its `ANTHROPIC_BASE_URL` can use the dedicated base above. Preserve saved client defaults when testing and verify the actual outgoing request path.

## Conversation contract

The OpenAI endpoints accept system/user/assistant/tool history. Text and structured content, assistant `content: null`, `tool_calls`, tool-result `tool_call_id`, names, tool definitions and `tool_choice` are retained. Anthropic system instructions and native `tool_use`/`tool_result` blocks are converted through the same native converter as the standard Messages API.

Streaming retains text and tool-call deltas, finish reason, and upstream usage when available. Native streams use Anthropic message/block lifecycle events. After partial output, an upstream failure is terminal and is not retried into a second model's answer. An SSE error is a failure even if a transport `[DONE]` follows it; do not accept a successful CLI exit code or a final prose claim as proof of coding completion.

OpenAI tool-result continuation:

```json
{
  "model": "auto-free",
  "messages": [
    {"role":"user","content":"Read demo.js."},
    {"role":"assistant","content":null,"tool_calls":[
      {"id":"call_read","type":"function","function":{"name":"read_file","arguments":"{\"path\":\"demo.js\"}"}}
    ]},
    {"role":"tool","tool_call_id":"call_read","content":"console.log('hello');"}
  ],
  "tools": [{"type":"function","function":{"name":"read_file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}],
  "tool_choice": "none",
  "contribute_to_dataset": false
}
```

The application executes tools; the endpoint does not execute client-supplied function calls itself.

## Model selection and controls

The OpenAI routes default to `auto-free` when `model` is omitted. Explicit model IDs are preserved through the model-aware wrapper rather than rewritten to `auto-free`. Dedicated requests use free-only selection and the managed relay's free-only headers; no paid fallback is enabled by using this namespace.

Supported companion controls are `godmode`, `custom_system_prompt`, `autotune`, `autotune_strategy`, `parseltongue`, `parseltongue_technique`, `parseltongue_intensity`, `stm_modules`, `frequency_penalty`, `presence_penalty`, `temperature`, `top_p` and `max_tokens`. OpenAI `max_completion_tokens` is accepted as an alias when `max_tokens` is absent. `autotune_strategy` is mapped to the companion's `strategy` wire field.

Dataset contribution defaults to **false** and is enabled only by an explicit `contribute_to_dataset: true`. Optional pipeline-module controls do not permit bypassing the managed companion. Public callers cannot use `X-DMRX-Godmode-Proxy` on dedicated routes; that loop-breaker belongs to the internal relay and its standard inference endpoint.

This is a coding-capable Chat Completions/Messages surface, not an implementation of every optional OpenAI API parameter or the Responses API. Advanced generation options must also be supported by the companion and selected upstream model. Provider tool-schema restrictions, quotas and availability still apply.

## Verification without a production restart

`scripts/verify-godmode-dedicated.ts` mounts the actual source handlers on an ephemeral loopback listener. It requires an explicitly isolated SQLite metadata backup, refuses to start without an existing healthy authenticated companion, and uses real inference through that companion and the existing gateway. It does not start a production gateway, fake a model response, or intentionally stop a companion.

```bash
DMRX_DATA_DIR=<isolated-backup-directory> \
DMRX_DEDICATED_TEST_DATA_DIR=<same-isolated-backup-directory> \
bun scripts/verify-godmode-dedicated.ts <state-json-path>
```

Do not publish the metadata backup: it contains local authentication material. For release acceptance, test actual client read/edit/execute loops, check artifacts and tool-result histories, preserve failed attempts, rebuild after final edits, and verify the production route after an approved gateway restart.
