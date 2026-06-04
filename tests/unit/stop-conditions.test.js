"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const stop_conditions_js_1 = require("../../packages/utils/src/stop-conditions.js");
(0, vitest_1.describe)('stop-conditions', () => {
    (0, vitest_1.describe)('stepCountIs', () => {
        (0, vitest_1.it)('should return false when steps < count', () => {
            const condition = (0, stop_conditions_js_1.stepCountIs)(5);
            (0, vitest_1.expect)(condition({ steps: [{ toolCalls: [] }, { toolCalls: [] }] })).toBe(false);
        });
        (0, vitest_1.it)('should return true when steps >= count', () => {
            const condition = (0, stop_conditions_js_1.stepCountIs)(3);
            (0, vitest_1.expect)(condition({ steps: [{ toolCalls: [] }, { toolCalls: [] }, { toolCalls: [] }] })).toBe(true);
        });
        (0, vitest_1.it)('should return true when steps exceed count', () => {
            const condition = (0, stop_conditions_js_1.stepCountIs)(2);
            (0, vitest_1.expect)(condition({ steps: [{ toolCalls: [] }, { toolCalls: [] }, { toolCalls: [] }, { toolCalls: [] }] })).toBe(true);
        });
        (0, vitest_1.it)('should return false for zero steps', () => {
            const condition = (0, stop_conditions_js_1.stepCountIs)(1);
            (0, vitest_1.expect)(condition({ steps: [] })).toBe(false);
        });
    });
    (0, vitest_1.describe)('hasToolCall', () => {
        (0, vitest_1.it)('should return true when tool was called', () => {
            const condition = (0, stop_conditions_js_1.hasToolCall)('search');
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [{ name: 'search' }] },
                ],
            })).toBe(true);
        });
        (0, vitest_1.it)('should return false when tool was not called', () => {
            const condition = (0, stop_conditions_js_1.hasToolCall)('search');
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [{ name: 'lookup' }] },
                ],
            })).toBe(false);
        });
        (0, vitest_1.it)('should return false for empty steps', () => {
            const condition = (0, stop_conditions_js_1.hasToolCall)('search');
            (0, vitest_1.expect)(condition({ steps: [] })).toBe(false);
        });
        (0, vitest_1.it)('should find tool call in later steps', () => {
            const condition = (0, stop_conditions_js_1.hasToolCall)('deploy');
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [{ name: 'search' }] },
                    { toolCalls: [{ name: 'analyze' }] },
                    { toolCalls: [{ name: 'deploy' }] },
                ],
            })).toBe(true);
        });
    });
    (0, vitest_1.describe)('maxTokensUsed', () => {
        (0, vitest_1.it)('should return false when under limit', () => {
            const condition = (0, stop_conditions_js_1.maxTokensUsed)(1000);
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [], usage: { totalTokens: 500 } },
                ],
            })).toBe(false);
        });
        (0, vitest_1.it)('should return true when at limit', () => {
            const condition = (0, stop_conditions_js_1.maxTokensUsed)(1000);
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [], usage: { totalTokens: 1000 } },
                ],
            })).toBe(true);
        });
        (0, vitest_1.it)('should accumulate tokens across steps', () => {
            const condition = (0, stop_conditions_js_1.maxTokensUsed)(1000);
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [], usage: { totalTokens: 400 } },
                    { toolCalls: [], usage: { totalTokens: 400 } },
                    { toolCalls: [], usage: { totalTokens: 300 } },
                ],
            })).toBe(true);
        });
        (0, vitest_1.it)('should handle missing usage gracefully', () => {
            const condition = (0, stop_conditions_js_1.maxTokensUsed)(1000);
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [] },
                    { toolCalls: [], usage: { totalTokens: 500 } },
                ],
            })).toBe(false);
        });
    });
    (0, vitest_1.describe)('maxCost', () => {
        (0, vitest_1.it)('should return false when under cost limit', () => {
            const condition = (0, stop_conditions_js_1.maxCost)(1.00);
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [], usage: { cost: 0.50 } },
                ],
            })).toBe(false);
        });
        (0, vitest_1.it)('should return true when at cost limit', () => {
            const condition = (0, stop_conditions_js_1.maxCost)(1.00);
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [], usage: { cost: 1.00 } },
                ],
            })).toBe(true);
        });
        (0, vitest_1.it)('should accumulate cost across steps', () => {
            const condition = (0, stop_conditions_js_1.maxCost)(1.00);
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [], usage: { cost: 0.30 } },
                    { toolCalls: [], usage: { cost: 0.30 } },
                    { toolCalls: [], usage: { cost: 0.50 } },
                ],
            })).toBe(true);
        });
        (0, vitest_1.it)('should handle missing cost gracefully', () => {
            const condition = (0, stop_conditions_js_1.maxCost)(1.00);
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [] },
                    { toolCalls: [], usage: { cost: 0.50 } },
                ],
            })).toBe(false);
        });
    });
    (0, vitest_1.describe)('finishReasonIs', () => {
        (0, vitest_1.it)('should return true when finish reason matches', () => {
            const condition = (0, stop_conditions_js_1.finishReasonIs)('length');
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [], finishReason: 'length' },
                ],
            })).toBe(true);
        });
        (0, vitest_1.it)('should return false when finish reason does not match', () => {
            const condition = (0, stop_conditions_js_1.finishReasonIs)('length');
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [], finishReason: 'stop' },
                ],
            })).toBe(false);
        });
        (0, vitest_1.it)('should return false when no steps have finish reason', () => {
            const condition = (0, stop_conditions_js_1.finishReasonIs)('length');
            (0, vitest_1.expect)(condition({
                steps: [
                    { toolCalls: [] },
                ],
            })).toBe(false);
        });
    });
    (0, vitest_1.describe)('isStopConditionMet', () => {
        (0, vitest_1.it)('should return true if ANY condition is met (OR logic)', async () => {
            const result = await (0, stop_conditions_js_1.isStopConditionMet)({
                stopConditions: [(0, stop_conditions_js_1.stepCountIs)(10), (0, stop_conditions_js_1.hasToolCall)('stop')],
                steps: [
                    { toolCalls: [{ name: 'stop' }] },
                ],
            });
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)('should return false if NO conditions are met', async () => {
            const result = await (0, stop_conditions_js_1.isStopConditionMet)({
                stopConditions: [(0, stop_conditions_js_1.stepCountIs)(10), (0, stop_conditions_js_1.hasToolCall)('stop')],
                steps: [
                    { toolCalls: [{ name: 'search' }] },
                ],
            });
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should return false for empty conditions array', async () => {
            const result = await (0, stop_conditions_js_1.isStopConditionMet)({
                stopConditions: [],
                steps: [{ toolCalls: [] }],
            });
            (0, vitest_1.expect)(result).toBe(false);
        });
        (0, vitest_1.it)('should support async conditions', async () => {
            const asyncCondition = async () => true;
            const result = await (0, stop_conditions_js_1.isStopConditionMet)({
                stopConditions: [asyncCondition],
                steps: [],
            });
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)('should work with multiple conditions all false', async () => {
            const result = await (0, stop_conditions_js_1.isStopConditionMet)({
                stopConditions: [(0, stop_conditions_js_1.stepCountIs)(100), (0, stop_conditions_js_1.maxTokensUsed)(999999), (0, stop_conditions_js_1.maxCost)(9999)],
                steps: [
                    { toolCalls: [], usage: { totalTokens: 10, cost: 0.01 } },
                ],
            });
            (0, vitest_1.expect)(result).toBe(false);
        });
    });
});
//# sourceMappingURL=stop-conditions.test.js.map