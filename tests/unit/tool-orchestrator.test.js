"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const tool_orchestrator_js_1 = require("../../packages/utils/src/tool-orchestrator.js");
// Mock heavy dependencies
vitest_1.vi.mock('../../packages/utils/src/stream-transformers.js', () => ({
    extractToolCallsFromResponse: vitest_1.vi.fn(() => []),
    responseHasToolCalls: vitest_1.vi.fn(() => false),
}));
vitest_1.vi.mock('../../packages/utils/src/stream-type-guards.js', () => ({
    isFunctionCallItem: vitest_1.vi.fn(() => false),
}));
vitest_1.vi.mock('../../packages/utils/src/tool-executor.js', () => ({
    executeTool: vitest_1.vi.fn(),
    findToolByName: vitest_1.vi.fn(),
}));
vitest_1.vi.mock('../../packages/utils/src/tool-types.js', () => ({
    hasExecuteFunction: vitest_1.vi.fn(() => false),
}));
vitest_1.vi.mock('../../packages/utils/src/turn-context.js', () => ({
    buildTurnContext: vitest_1.vi.fn(() => ({})),
}));
vitest_1.vi.mock('../../packages/utils/src/next-turn-params.js', () => ({
    executeNextTurnParamsFunctions: vitest_1.vi.fn(async () => ({})),
    applyNextTurnParamsToRequest: vitest_1.vi.fn((req) => req),
}));
(0, vitest_1.describe)('tool-orchestrator', () => {
    (0, vitest_1.describe)('toolResultsToMap', () => {
        (0, vitest_1.it)('should convert results array to map keyed by toolCallId', () => {
            const results = [
                { toolCallId: 'call_1', toolName: 'search', result: { data: 'test' } },
                { toolCallId: 'call_2', toolName: 'lookup', result: { id: 123 } },
            ];
            const map = (0, tool_orchestrator_js_1.toolResultsToMap)(results);
            (0, vitest_1.expect)(map.size).toBe(2);
            (0, vitest_1.expect)(map.get('call_1')).toEqual({ result: { data: 'test' }, preliminaryResults: undefined });
            (0, vitest_1.expect)(map.get('call_2')).toEqual({ result: { id: 123 }, preliminaryResults: undefined });
        });
        (0, vitest_1.it)('should include preliminary results', () => {
            const results = [
                {
                    toolCallId: 'call_1',
                    toolName: 'gen',
                    result: 'final',
                    preliminaryResults: ['interim1', 'interim2'],
                },
            ];
            const map = (0, tool_orchestrator_js_1.toolResultsToMap)(results);
            (0, vitest_1.expect)(map.get('call_1')?.preliminaryResults).toEqual(['interim1', 'interim2']);
        });
        (0, vitest_1.it)('should handle empty results', () => {
            const map = (0, tool_orchestrator_js_1.toolResultsToMap)([]);
            (0, vitest_1.expect)(map.size).toBe(0);
        });
    });
    (0, vitest_1.describe)('summarizeToolExecutions', () => {
        (0, vitest_1.it)('should format successful executions', () => {
            const results = [
                { toolCallId: 'c1', toolName: 'search', result: 'ok' },
            ];
            const summary = (0, tool_orchestrator_js_1.summarizeToolExecutions)(results);
            (0, vitest_1.expect)(summary).toContain('[OK]');
            (0, vitest_1.expect)(summary).toContain('search');
            (0, vitest_1.expect)(summary).toContain('SUCCESS');
        });
        (0, vitest_1.it)('should format error executions', () => {
            const results = [
                { toolCallId: 'c1', toolName: 'deploy', result: null, error: new Error('failed') },
            ];
            const summary = (0, tool_orchestrator_js_1.summarizeToolExecutions)(results);
            (0, vitest_1.expect)(summary).toContain('[ERROR]');
            (0, vitest_1.expect)(summary).toContain('deploy');
            (0, vitest_1.expect)(summary).toContain('failed');
        });
        (0, vitest_1.it)('should include preliminary result count', () => {
            const results = [
                {
                    toolCallId: 'c1',
                    toolName: 'stream',
                    result: 'final',
                    preliminaryResults: ['a', 'b', 'c'],
                },
            ];
            const summary = (0, tool_orchestrator_js_1.summarizeToolExecutions)(results);
            (0, vitest_1.expect)(summary).toContain('3 preliminary results');
        });
        (0, vitest_1.it)('should handle mixed results', () => {
            const results = [
                { toolCallId: 'c1', toolName: 'search', result: 'ok' },
                { toolCallId: 'c2', toolName: 'fail', result: null, error: new Error('oops') },
            ];
            const summary = (0, tool_orchestrator_js_1.summarizeToolExecutions)(results);
            (0, vitest_1.expect)(summary).toContain('[OK] search');
            (0, vitest_1.expect)(summary).toContain('[ERROR] fail');
        });
    });
    (0, vitest_1.describe)('hasToolExecutionErrors', () => {
        (0, vitest_1.it)('should return true when errors exist', () => {
            const results = [
                { toolCallId: 'c1', toolName: 'ok', result: 'fine' },
                { toolCallId: 'c2', toolName: 'bad', result: null, error: new Error('fail') },
            ];
            (0, vitest_1.expect)((0, tool_orchestrator_js_1.hasToolExecutionErrors)(results)).toBe(true);
        });
        (0, vitest_1.it)('should return false when no errors', () => {
            const results = [
                { toolCallId: 'c1', toolName: 'ok', result: 'fine' },
            ];
            (0, vitest_1.expect)((0, tool_orchestrator_js_1.hasToolExecutionErrors)(results)).toBe(false);
        });
        (0, vitest_1.it)('should return false for empty results', () => {
            (0, vitest_1.expect)((0, tool_orchestrator_js_1.hasToolExecutionErrors)([])).toBe(false);
        });
    });
    (0, vitest_1.describe)('getToolExecutionErrors', () => {
        (0, vitest_1.it)('should return only error objects', () => {
            const err1 = new Error('fail1');
            const err2 = new Error('fail2');
            const results = [
                { toolCallId: 'c1', toolName: 'ok', result: 'fine' },
                { toolCallId: 'c2', toolName: 'bad1', result: null, error: err1 },
                { toolCallId: 'c3', toolName: 'bad2', result: null, error: err2 },
            ];
            const errors = (0, tool_orchestrator_js_1.getToolExecutionErrors)(results);
            (0, vitest_1.expect)(errors).toHaveLength(2);
            (0, vitest_1.expect)(errors[0]).toBe(err1);
            (0, vitest_1.expect)(errors[1]).toBe(err2);
        });
        (0, vitest_1.it)('should return empty array when no errors', () => {
            const results = [
                { toolCallId: 'c1', toolName: 'ok', result: 'fine' },
            ];
            (0, vitest_1.expect)((0, tool_orchestrator_js_1.getToolExecutionErrors)(results)).toEqual([]);
        });
    });
});
//# sourceMappingURL=tool-orchestrator.test.js.map