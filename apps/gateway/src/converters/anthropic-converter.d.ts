import type { UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
export interface AnthropicMessagesRequest {
    model: string;
    max_tokens: number;
    system?: string | AnthropicContentBlock[];
    messages: AnthropicMessage[];
    tools?: AnthropicTool[];
    tool_choice?: AnthropicToolChoice;
    temperature?: number;
    top_p?: number;
    stop_sequences?: string[];
    stream?: boolean;
    metadata?: {
        user_id?: string;
    };
}
export interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
}
export type AnthropicContentBlock = {
    type: 'text';
    text: string;
} | {
    type: 'image';
    source: {
        type: 'base64';
        media_type: string;
        data: string;
    };
} | {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
} | {
    type: 'tool_result';
    tool_use_id: string;
    content?: string | AnthropicContentBlock[];
};
export interface AnthropicTool {
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
}
export type AnthropicToolChoice = {
    type: 'auto';
} | {
    type: 'any';
} | {
    type: 'none';
} | {
    type: 'tool';
    name: string;
};
export interface AnthropicMessagesResponse {
    type: 'message';
    id: string;
    role: 'assistant';
    content: AnthropicResponseContentBlock[];
    model: string;
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
    stop_sequence: string | null;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}
export type AnthropicResponseContentBlock = {
    type: 'text';
    text: string;
} | {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
};
export declare function convertAnthropicRequestToUnified(body: AnthropicMessagesRequest, metadata: Record<string, unknown>): UnifiedRequest;
export declare function convertUnifiedResponseToAnthropic(response: UnifiedResponse): AnthropicMessagesResponse;
//# sourceMappingURL=anthropic-converter.d.ts.map