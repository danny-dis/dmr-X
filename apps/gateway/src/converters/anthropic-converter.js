// --- Conversion Functions ---
export function convertAnthropicRequestToUnified(body, metadata) {
    const messages = [];
    // Extract system prompt into a message
    if (body.system) {
        const systemContent = typeof body.system === 'string'
            ? body.system
            : body.system.map(b => b.type === 'text' ? b.text : '').join('');
        messages.push({ role: 'system', content: systemContent });
    }
    // Convert messages
    for (const msg of body.messages) {
        if (typeof msg.content === 'string') {
            messages.push({ role: msg.role, content: msg.content });
            continue;
        }
        // Handle content blocks
        const textParts = [];
        const toolCalls = [];
        const toolResults = [];
        for (const block of msg.content) {
            switch (block.type) {
                case 'text':
                    textParts.push(block.text);
                    break;
                case 'image':
                    // Convert Anthropic image to unified image_url format
                    textParts.push(''); // placeholder, images go in content parts
                    break;
                case 'tool_use':
                    toolCalls.push({
                        id: block.id,
                        type: 'function',
                        function: {
                            name: block.name,
                            arguments: JSON.stringify(block.input),
                        },
                    });
                    break;
                case 'tool_result':
                    toolResults.push({
                        role: 'tool',
                        tool_call_id: block.tool_use_id,
                        content: typeof block.content === 'string'
                            ? block.content
                            : JSON.stringify(block.content),
                    });
                    break;
            }
        }
        // For assistant messages with tool_calls
        if (msg.role === 'assistant' && toolCalls.length > 0) {
            messages.push({
                role: 'assistant',
                content: textParts.join('') || '',
                tool_calls: toolCalls,
            });
            continue;
        }
        // For user messages, emit text first, then tool results as separate messages
        if (textParts.join('').trim()) {
            messages.push({ role: msg.role, content: textParts.join('') });
        }
        for (const tr of toolResults) {
            messages.push(tr);
        }
    }
    // Convert tools
    const tools = body.tools?.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
        },
    }));
    // Convert tool_choice
    let toolChoice;
    if (body.tool_choice) {
        switch (body.tool_choice.type) {
            case 'auto':
                toolChoice = 'auto';
                break;
            case 'any':
                toolChoice = 'required';
                break;
            case 'none':
                toolChoice = 'none';
                break;
            case 'tool':
                toolChoice = { type: 'function', function: { name: body.tool_choice.name } };
                break;
        }
    }
    return {
        modality: 'llm',
        model: body.model,
        messages,
        tools,
        tool_choice: toolChoice,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        top_p: body.top_p,
        stop: body.stop_sequences,
        stream: body.stream ?? false,
        user: body.metadata?.user_id,
        metadata,
    };
}
export function convertUnifiedResponseToAnthropic(response) {
    const content = [];
    // Add text content
    if (response.message?.content) {
        content.push({ type: 'text', text: response.message.content });
    }
    // Add tool_use blocks
    if (response.message?.tool_calls) {
        for (const tc of response.message.tool_calls) {
            content.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments),
            });
        }
    }
    // Map finish reason
    const stopReasonMap = {
        stop: 'end_turn',
        tool_calls: 'tool_use',
        length: 'max_tokens',
        content_filter: 'end_turn',
    };
    const stopReason = response.finishReason
        ? (stopReasonMap[response.finishReason] ?? null)
        : null;
    return {
        type: 'message',
        id: response.requestId,
        role: 'assistant',
        content,
        model: response.modelId,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: response.usage?.prompt_tokens ?? 0,
            output_tokens: response.usage?.completion_tokens ?? 0,
        },
    };
}
//# sourceMappingURL=anthropic-converter.js.map