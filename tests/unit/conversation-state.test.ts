import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateConversationId,
  createInitialState,
  updateState,
  appendToMessages,
  toolRequiresApproval,
  partitionToolCalls,
  createUnsentResult,
  createRejectedResult,
  unsentResultsToAPIFormat,
  extractTextFromResponse,
  extractToolCallsFromResponse,
} from '../../packages/utils/src/conversation-state.js';

describe('conversation-state', () => {
  describe('generateConversationId', () => {
    it('should generate a unique ID with conv_ prefix', () => {
      const id = generateConversationId();
      expect(id).toMatch(/^conv_/);
    });

    it('should generate different IDs on successive calls', () => {
      const id1 = generateConversationId();
      const id2 = generateConversationId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('createInitialState', () => {
    it('should create initial state with defaults', () => {
      const state = createInitialState();
      expect(state.status).toBe('in_progress');
      expect(state.messages).toEqual([]);
      expect(state.id).toMatch(/^conv_/);
      expect(state.createdAt).toBeGreaterThan(0);
      expect(state.updatedAt).toBeGreaterThan(0);
    });

    it('should accept custom ID', () => {
      const state = createInitialState('custom_id');
      expect(state.id).toBe('custom_id');
    });
  });

  describe('updateState', () => {
    it('should merge updates and update timestamp', () => {
      const initial = createInitialState('test_id');
      const originalUpdated = initial.updatedAt;

      // Small delay to ensure timestamp changes
      const updated = updateState(initial, { status: 'completed' });
      expect(updated.status).toBe('completed');
      expect(updated.id).toBe('test_id');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdated);
    });

    it('should preserve id and createdAt', () => {
      const initial = createInitialState('preserve_test');
      const updated = updateState(initial, { status: 'error' });
      expect(updated.id).toBe('preserve_test');
      expect(updated.createdAt).toBe(initial.createdAt);
    });
  });

  describe('appendToMessages', () => {
    it('should append items to array input', () => {
      const current = [{ role: 'user', content: 'hello' }];
      const newItems = [{ role: 'assistant', content: 'hi' }];
      const result = appendToMessages(current, newItems);
      expect(result).toHaveLength(2);
    });

    it('should normalize single item to array and append', () => {
      const current = { role: 'user', content: 'hello' };
      const newItems = [{ role: 'assistant', content: 'hi' }];
      const result = appendToMessages(current, newItems);
      expect(Array.isArray(result)).toBe(true);
      expect((result as any[])).toHaveLength(2);
    });
  });

  describe('toolRequiresApproval', () => {
    const mockContext = { numberOfTurns: 1, toolCall: {}, turnRequest: {} } as any;

    it('should return false when tool has no requireApproval', async () => {
      const toolCall = { id: 'c1', name: 'test', arguments: {} };
      const tools = [{ type: 'function' as const, function: { name: 'test' } }];
      const result = await toolRequiresApproval(toolCall, tools as any, mockContext);
      expect(result).toBe(false);
    });

    it('should return true when tool has requireApproval=true', async () => {
      const toolCall = { id: 'c1', name: 'test', arguments: {} };
      const tools = [{ type: 'function' as const, function: { name: 'test', requireApproval: true } }];
      const result = await toolRequiresApproval(toolCall, tools as any, mockContext);
      expect(result).toBe(true);
    });

    it('should use call-level check over tool-level', async () => {
      const toolCall = { id: 'c1', name: 'test', arguments: {} };
      const tools = [{ type: 'function' as const, function: { name: 'test', requireApproval: true } }];
      const callLevelCheck = vi.fn().mockResolvedValue(false);
      const result = await toolRequiresApproval(toolCall, tools as any, mockContext, callLevelCheck);
      expect(result).toBe(false);
      expect(callLevelCheck).toHaveBeenCalledWith(toolCall, mockContext);
    });

    it('should call function-type requireApproval', async () => {
      const approvalFn = vi.fn().mockResolvedValue(true);
      const toolCall = { id: 'c1', name: 'test', arguments: { action: 'delete' } };
      const tools = [{ type: 'function' as const, function: { name: 'test', requireApproval: approvalFn } }];
      const result = await toolRequiresApproval(toolCall, tools as any, mockContext);
      expect(result).toBe(true);
      expect(approvalFn).toHaveBeenCalledWith({ action: 'delete' }, mockContext);
    });
  });

  describe('partitionToolCalls', () => {
    const mockContext = { numberOfTurns: 1, toolCall: {}, turnRequest: {} } as any;

    it('should partition into approval and auto-execute', async () => {
      const toolCalls = [
        { id: 'c1', name: 'safe_tool', arguments: {} },
        { id: 'c2', name: 'dangerous_tool', arguments: {} },
      ];
      const tools = [
        { type: 'function' as const, function: { name: 'safe_tool', requireApproval: false } },
        { type: 'function' as const, function: { name: 'dangerous_tool', requireApproval: true } },
      ];

      const result = await partitionToolCalls(toolCalls as any, tools as any, mockContext);
      expect(result.autoExecute).toHaveLength(1);
      expect(result.requiresApproval).toHaveLength(1);
      expect(result.autoExecute[0].name).toBe('safe_tool');
      expect(result.requiresApproval[0].name).toBe('dangerous_tool');
    });
  });

  describe('createUnsentResult', () => {
    it('should create a valid unsent result', () => {
      const result = createUnsentResult('call_1', 'search', { data: 'test' });
      expect(result.callId).toBe('call_1');
      expect(result.name).toBe('search');
      expect(result.output).toEqual({ data: 'test' });
    });
  });

  describe('createRejectedResult', () => {
    it('should create a rejected result with default message', () => {
      const result = createRejectedResult('call_1', 'dangerous');
      expect(result.callId).toBe('call_1');
      expect(result.output).toBeNull();
      expect(result.error).toBe('Tool call rejected by user');
    });

    it('should accept custom rejection reason', () => {
      const result = createRejectedResult('call_1', 'dangerous', 'Too risky');
      expect(result.error).toBe('Too risky');
    });
  });

  describe('unsentResultsToAPIFormat', () => {
    it('should convert results to API format', () => {
      const results = [
        { callId: 'call_1', name: 'test', output: { data: 'result' } },
      ];
      const apiFormat = unsentResultsToAPIFormat(results);
      expect(apiFormat).toHaveLength(1);
      expect(apiFormat[0].type).toBe('function_call_output');
      expect(apiFormat[0].callId).toBe('call_1');
      expect(JSON.parse(apiFormat[0].output)).toEqual({ data: 'result' });
    });

    it('should stringify errors', () => {
      const results = [
        { callId: 'call_1', name: 'test', output: null, error: 'failed' },
      ];
      const apiFormat = unsentResultsToAPIFormat(results);
      expect(JSON.parse(apiFormat[0].output)).toEqual({ error: 'failed' });
    });
  });

  describe('extractTextFromResponse', () => {
    it('should extract text from message output', () => {
      const response = {
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Hello world' }],
          },
        ],
      } as any;
      expect(extractTextFromResponse(response)).toBe('Hello world');
    });

    it('should return empty string for no output', () => {
      expect(extractTextFromResponse({} as any)).toBe('');
    });

    it('should concatenate multiple text parts', () => {
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
      } as any;
      expect(extractTextFromResponse(response)).toBe('Hello world');
    });
  });

  describe('extractToolCallsFromResponse', () => {
    it('should extract tool calls with parsed arguments', () => {
      const response = {
        output: [
          {
            type: 'function_call',
            callId: 'call_1',
            name: 'search',
            arguments: '{"query":"test"}',
          },
        ],
      } as any;

      const result = extractToolCallsFromResponse(response);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('search');
      expect(result[0].arguments).toEqual({ query: 'test' });
    });

    it('should return empty array when no function calls', () => {
      const response = {
        output: [{ type: 'message', content: [] }],
      } as any;
      expect(extractToolCallsFromResponse(response)).toEqual([]);
    });

    it('should skip malformed tool calls gracefully', () => {
      const response = {
        output: [
          {
            type: 'function_call',
            callId: 'call_1',
            name: 'broken',
            arguments: 'not-json',
          },
        ],
      } as any;

      // Malformed JSON causes the parser to warn and skip (continue), returning empty
      const result = extractToolCallsFromResponse(response);
      expect(result).toEqual([]);
    });
  });
});
