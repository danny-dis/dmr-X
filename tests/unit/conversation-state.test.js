"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const conversation_state_js_1 = require("../../packages/utils/src/conversation-state.js");
(0, vitest_1.describe)('conversation-state', () => {
    (0, vitest_1.describe)('generateConversationId', () => {
        (0, vitest_1.it)('should generate a unique ID with conv_ prefix', () => {
            const id = (0, conversation_state_js_1.generateConversationId)();
            (0, vitest_1.expect)(id).toMatch(/^conv_/);
        });
        (0, vitest_1.it)('should generate different IDs on successive calls', () => {
            const id1 = (0, conversation_state_js_1.generateConversationId)();
            const id2 = (0, conversation_state_js_1.generateConversationId)();
            (0, vitest_1.expect)(id1).not.toBe(id2);
        });
    });
    (0, vitest_1.describe)('createInitialState', () => {
        (0, vitest_1.it)('should create initial state with defaults', () => {
            const state = (0, conversation_state_js_1.createInitialState)();
            (0, vitest_1.expect)(state.status).toBe('in_progress');
            (0, vitest_1.expect)(state.messages).toEqual([]);
            (0, vitest_1.expect)(state.id).toMatch(/^conv_/);
            (0, vitest_1.expect)(state.createdAt).toBeGreaterThan(0);
            (0, vitest_1.expect)(state.updatedAt).toBeGreaterThan(0);
        });
        (0, vitest_1.it)('should accept custom ID', () => {
            const state = (0, conversation_state_js_1.createInitialState)('custom_id');
            (0, vitest_1.expect)(state.id).toBe('custom_id');
        });
    });
    (0, vitest_1.describe)('updateState', () => {
        (0, vitest_1.it)('should merge updates and update timestamp', () => {
            const initial = (0, conversation_state_js_1.createInitialState)('test_id');
            const originalUpdated = initial.updatedAt;
            // Small delay to ensure timestamp changes
            const updated = (0, conversation_state_js_1.updateState)(initial, { status: 'completed' });
            (0, vitest_1.expect)(updated.status).toBe('completed');
            (0, vitest_1.expect)(updated.id).toBe('test_id');
            (0, vitest_1.expect)(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdated);
        });
        (0, vitest_1.it)('should preserve id and createdAt', () => {
            const initial = (0, conversation_state_js_1.createInitialState)('preserve_test');
            const updated = (0, conversation_state_js_1.updateState)(initial, { status: 'error' });
            (0, vitest_1.expect)(updated.id).toBe('preserve_test');
            (0, vitest_1.expect)(updated.createdAt).toBe(initial.createdAt);
        });
    });
    (0, vitest_1.describe)('appendToMessages', () => {
        (0, vitest_1.it)('should append items to array input', () => {
            const current = [{ role: 'user', content: 'hello' }];
            const newItems = [{ role: 'assistant', content: 'hi' }];
            const result = (0, conversation_state_js_1.appendToMessages)(current, newItems);
            (0, vitest_1.expect)(result).toHaveLength(2);
        });
        (0, vitest_1.it)('should normalize single item to array and append', () => {
            const current = { role: 'user', content: 'hello' };
            const newItems = [{ role: 'assistant', content: 'hi' }];
            const result = (0, conversation_state_js_1.appendToMessages)(current, newItems);
            (0, vitest_1.expect)(Array.isArray(result)).toBe(true);
            (0, vitest_1.expect)(result).toHaveLength(2);
        });
    });
    (0, vitest_1.describe)('toolRequiresApproval', () => {
        const mockContext = { numberOfTurns: 1, toolCall: {}, turnRequest: {} };
        (0, vitest_1.it)('should return false when tool has no requireApproval', async () => {
            const toolCall = { id: 'c1', name: 'test', arguments: {} };
            const tools = [{ type: 'function', function: { name: 'test' } }];
            const result = await (0, conversation_state_js_1.toolRequiresApproval)(toolCall, tools, mockContext);
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should return true when tool has requireApproval=true', async () => {
            const toolCall = { id: 'c1', name: 'test', arguments: {} };
            const tools = [{ type: 'function', function: { name: 'test', requireApproval: true } }];
            const result = await (0, conversation_state_js_1.toolRequiresApproval)(toolCall, tools, mockContext);
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)('should use call-level check over tool-level', async () => {
            const toolCall = { id: 'c1', name: 'test', arguments: {} };
            const tools = [{ type: 'function', function: { name: 'test', requireApproval: true } }];
            const callLevelCheck = vitest_1.vi.fn().mockResolvedValue(false);
            const result = await (0, conversation_state_js_1.toolRequiresApproval)(toolCall, tools, mockContext, callLevelCheck);
            (0, vitest_1.expect)(result).toBe(false);
            (0, vitest_1.expect)(callLevelCheck).toHaveBeenCalledWith(toolCall, mockContext);
        });
        (0, vitest_1.it)('should call function-type requireApproval', async () => {
            const approvalFn = vitest_1.vi.fn().mockResolvedValue(true);
            const toolCall = { id: 'c1', name: 'test', arguments: { action: 'delete' } };
            const tools = [{ type: 'function', function: { name: 'test', requireApproval: approvalFn } }];
            const result = await (0, conversation_state_js_1.toolRequiresApproval)(toolCall, tools, mockContext);
            (0, vitest_1.expect)(result).toBe(true);
            (0, vitest_1.expect)(approvalFn).toHaveBeenCalledWith({ action: 'delete' }, mockContext);
        });
    });
    (0, vitest_1.describe)('partitionToolCalls', () => {
        const mockContext = { numberOfTurns: 1, toolCall: {}, turnRequest: {} };
        (0, vitest_1.it)('should partition into approval and auto-execute', async () => {
            const toolCalls = [
                { id: 'c1', name: 'safe_tool', arguments: {} },
                { id: 'c2', name: 'dangerous_tool', arguments: {} },
            ];
            const tools = [
                { type: 'function', function: { name: 'safe_tool', requireApproval: false } },
                { type: 'function', function: { name: 'dangerous_tool', requireApproval: true } },
            ];
            const result = await (0, conversation_state_js_1.partitionToolCalls)(toolCalls, tools, mockContext);
            (0, vitest_1.expect)(result.autoExecute).toHaveLength(1);
            (0, vitest_1.expect)(result.requiresApproval).toHaveLength(1);
            (0, vitest_1.expect)(result.autoExecute[0].name).toBe('safe_tool');
            (0, vitest_1.expect)(result.requiresApproval[0].name).toBe('dangerous_tool');
        });
    });
    (0, vitest_1.describe)('createUnsentResult', () => {
        (0, vitest_1.it)('should create a valid unsent result', () => {
            const result = (0, conversation_state_js_1.createUnsentResult)('call_1', 'search', { data: 'test' });
            (0, vitest_1.expect)(result.callId).toBe('call_1');
            (0, vitest_1.expect)(result.name).toBe('search');
            (0, vitest_1.expect)(result.output).toEqual({ data: 'test' });
        });
    });
    (0, vitest_1.describe)('createRejectedResult', () => {
        (0, vitest_1.it)('should create a rejected result with default message', () => {
            const result = (0, conversation_state_js_1.createRejectedResult)('call_1', 'dangerous');
            (0, vitest_1.expect)(result.callId).toBe('call_1');
            (0, vitest_1.expect)(result.output).toBeNull();
            (0, vitest_1.expect)(result.error).toBe('Tool call rejected by user');
        });
        (0, vitest_1.it)('should accept custom rejection reason', () => {
            const result = (0, conversation_state_js_1.createRejectedResult)('call_1', 'dangerous', 'Too risky');
            (0, vitest_1.expect)(result.error).toBe('Too risky');
        });
    });
    (0, vitest_1.describe)('unsentResultsToAPIFormat', () => {
        (0, vitest_1.it)('should convert results to API format', () => {
            const results = [
                { callId: 'call_1', name: 'test', output: { data: 'result' } },
            ];
            const apiFormat = (0, conversation_state_js_1.unsentResultsToAPIFormat)(results);
            (0, vitest_1.expect)(apiFormat).toHaveLength(1);
            (0, vitest_1.expect)(apiFormat[0].type).toBe('function_call_output');
            (0, vitest_1.expect)(apiFormat[0].callId).toBe('call_1');
            (0, vitest_1.expect)(JSON.parse(apiFormat[0].output)).toEqual({ data: 'result' });
        });
        (0, vitest_1.it)('should stringify errors', () => {
            const results = [
                { callId: 'call_1', name: 'test', output: null, error: 'failed' },
            ];
            const apiFormat = (0, conversation_state_js_1.unsentResultsToAPIFormat)(results);
            (0, vitest_1.expect)(JSON.parse(apiFormat[0].output)).toEqual({ error: 'failed' });
        });
    });
    (0, vitest_1.describe)('extractTextFromResponse', () => {
        (0, vitest_1.it)('should extract text from message output', () => {
            const response = {
                output: [
                    {
                        type: 'message',
                        content: [{ type: 'output_text', text: 'Hello world' }],
                    },
                ],
            };
            (0, vitest_1.expect)((0, conversation_state_js_1.extractTextFromResponse)(response)).toBe('Hello world');
        });
        (0, vitest_1.it)('should return empty string for no output', () => {
            (0, vitest_1.expect)((0, conversation_state_js_1.extractTextFromResponse)({})).toBe('');
        });
        (0, vitest_1.it)('should concatenate multiple text parts', () => {
            const response = {
                output: [
                    {
                        type: 'message',
                        content: [
                            { type: 'output_text', text: 'Hello ' },
                            { type: 'output_text', text: 'world' },
                        ],
                    },
                ],
            };
            (0, vitest_1.expect)((0, conversation_state_js_1.extractTextFromResponse)(response)).toBe('Hello world');
        });
    });
    (0, vitest_1.describe)('extractToolCallsFromResponse', () => {
        (0, vitest_1.it)('should extract tool calls with parsed arguments', () => {
            const response = {
                output: [
                    {
                        type: 'function_call',
                        callId: 'call_1',
                        name: 'search',
                        arguments: '{"query":"test"}',
                    },
                ],
            };
            const result = (0, conversation_state_js_1.extractToolCallsFromResponse)(response);
            (0, vitest_1.expect)(result).toHaveLength(1);
            (0, vitest_1.expect)(result[0].name).toBe('search');
            (0, vitest_1.expect)(result[0].arguments).toEqual({ query: 'test' });
        });
        (0, vitest_1.it)('should return empty array when no function calls', () => {
            const response = {
                output: [{ type: 'message', content: [] }],
            };
            (0, vitest_1.expect)((0, conversation_state_js_1.extractToolCallsFromResponse)(response)).toEqual([]);
        });
        (0, vitest_1.it)('should skip malformed tool calls gracefully', () => {
            const response = {
                output: [
                    {
                        type: 'function_call',
                        callId: 'call_1',
                        name: 'broken',
                        arguments: 'not-json',
                    },
                ],
            };
            // Malformed JSON causes the parser to warn and skip (continue), returning empty
            const result = (0, conversation_state_js_1.extractToolCallsFromResponse)(response);
            (0, vitest_1.expect)(result).toEqual([]);
        });
    });
});
//# sourceMappingURL=conversation-state.test.js.map