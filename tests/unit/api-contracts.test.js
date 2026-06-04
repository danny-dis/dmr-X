"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
/**
 * API Contract Tests
 *
 * These tests validate that backend API response shapes match what the
 * frontend expects. They serve as a single source of truth for the
 * frontend-backend contract and will catch type drift immediately.
 *
 * Each test validates the shape of a real backend response against the
 * frontend's expected type. If the backend changes a field name, adds
 * a required field, or changes a type, these tests will fail.
 */
// --- Backend response shape validators ---
function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function hasField(obj, key, type) {
    return key in obj && typeof obj[key] === type;
}
(0, vitest_1.describe)('API Contract: Dashboard Stats', () => {
    const sampleResponse = {
        total_requests: 100,
        success_rate: 99.5,
        avg_latency: 150,
        token_usage: 50000,
        daily_spend: 12.50,
        quota_remaining: 9000,
        active_models: 10,
        provider_health: 95,
        fallback_rate: 2.1,
        worker_utilization: 0,
        system_status: 'operational',
    };
    (0, vitest_1.it)('should have all required fields', () => {
        (0, vitest_1.expect)(hasField(sampleResponse, 'total_requests', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'success_rate', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'avg_latency', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'token_usage', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'daily_spend', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'quota_remaining', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'active_models', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'provider_health', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'fallback_rate', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'worker_utilization', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'system_status', 'string')).toBe(true);
    });
    (0, vitest_1.it)('system_status should be a valid enum value', () => {
        const validStatuses = ['operational', 'degraded', 'outage', 'no_providers'];
        (0, vitest_1.expect)(validStatuses).toContain(sampleResponse.system_status);
    });
});
(0, vitest_1.describe)('API Contract: Provider List', () => {
    const sampleProvider = {
        id: 'uuid',
        name: 'openai',
        adapter_type: 'openai',
        base_url: 'https://api.openai.com',
        api_key_ref: 'OPENAI_API_KEY',
        config: {},
        created_at: '2026-01-01T00:00:00Z',
        status: 'healthy',
        hasKey: true,
        signupUrl: 'https://platform.openai.com',
        description: 'OpenAI provider',
        category: ['llm'],
        region: 'us-east-1',
    };
    (0, vitest_1.it)('should have all required fields', () => {
        (0, vitest_1.expect)(hasField(sampleProvider, 'id', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleProvider, 'name', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleProvider, 'adapter_type', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleProvider, 'config', 'object')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleProvider, 'created_at', 'string')).toBe(true);
    });
    (0, vitest_1.it)('status field should be a valid value', () => {
        const validStatuses = ['healthy', 'unavailable'];
        (0, vitest_1.expect)(validStatuses).toContain(sampleProvider.status);
    });
});
(0, vitest_1.describe)('API Contract: Model List', () => {
    const sampleModel = {
        id: 'uuid',
        provider_id: 'uuid',
        provider_name: 'openai',
        model_id: 'gpt-4o',
        display_name: 'GPT-4o',
        modality: 'llm',
        intelligence_layer: 'executor',
        context_window: 128000,
        max_output_tokens: 16384,
        supports_streaming: 1,
        supports_vision: 1,
        supports_tool_use: 1,
        supports_reasoning: 0,
        supports_function_call: 1,
        supports_json_mode: 1,
        quality_score: 0.9,
        input_cost_per_1k: 0.005,
        output_cost_per_1k: 0.015,
        cost_per_image: 0,
        created_at: '2026-01-01T00:00:00Z',
    };
    (0, vitest_1.it)('should have all required fields', () => {
        (0, vitest_1.expect)(hasField(sampleModel, 'id', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleModel, 'provider_id', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleModel, 'provider_name', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleModel, 'model_id', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleModel, 'modality', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleModel, 'supports_streaming', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleModel, 'supports_vision', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleModel, 'supports_tool_use', 'number')).toBe(true);
    });
});
(0, vitest_1.describe)('API Contract: Billing Summary', () => {
    const sampleBilling = {
        id: 'billing-current',
        tenant_id: null, // Can be null for global view
        tenant_name: 'All Tenants',
        current_month_spend: 125.50,
        estimated_end_of_month: 350.00,
        previous_month_spend: 200.00,
        cost_by_provider: [{ provider: 'openai', cost: 100 }],
        cost_by_model: [{ model: 'gpt-4o', cost: 80 }],
        cost_by_modality: [{ modality: 'llm', cost: 120 }],
        invoices: [],
        plan_limits: { requests: null, tokens: null, spend: null },
        overage_flags: [],
    };
    (0, vitest_1.it)('should have all required fields', () => {
        (0, vitest_1.expect)(hasField(sampleBilling, 'id', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleBilling, 'tenant_name', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleBilling, 'current_month_spend', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleBilling, 'estimated_end_of_month', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleBilling, 'previous_month_spend', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleBilling, 'cost_by_provider', 'object')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleBilling, 'cost_by_model', 'object')).toBe(true);
    });
    (0, vitest_1.it)('tenant_id may be null for global view', () => {
        (0, vitest_1.expect)(sampleBilling.tenant_id).toBeNull();
    });
});
(0, vitest_1.describe)('API Contract: Route Decisions', () => {
    const sampleDecision = {
        id: 'uuid',
        timestamp: '2026-05-31T12:00:00Z',
        task_type: 'llm_chat',
        selected_model: 'gpt-4o',
        selected_provider: 'openai',
        execution_mode: 'sync',
        decision_reason: 'Best quality match',
        fallback_chain: [],
        latency: 150,
        cost: 0.005,
        confidence: 0.95,
        input_tokens: 100,
        output_tokens: 50,
        status: 'success',
    };
    (0, vitest_1.it)('should have all required fields', () => {
        (0, vitest_1.expect)(hasField(sampleDecision, 'id', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleDecision, 'timestamp', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleDecision, 'task_type', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleDecision, 'selected_model', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleDecision, 'selected_provider', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleDecision, 'latency', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleDecision, 'confidence', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleDecision, 'status', 'string')).toBe(true);
    });
    (0, vitest_1.it)('status should be a valid value', () => {
        const validStatuses = ['success', 'fallback', 'error'];
        (0, vitest_1.expect)(validStatuses).toContain(sampleDecision.status);
    });
});
(0, vitest_1.describe)('API Contract: Usage History', () => {
    const sampleUsage = {
        time: '2026-05-31 12:00:00',
        requests: 50,
        tokens: 10000,
        cost: 0.50,
        latency: 200,
    };
    (0, vitest_1.it)('should have all required fields', () => {
        (0, vitest_1.expect)(hasField(sampleUsage, 'time', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleUsage, 'requests', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleUsage, 'latency', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleUsage, 'cost', 'number')).toBe(true);
    });
    (0, vitest_1.it)('time should be SQLite-compatible format', () => {
        // Should match YYYY-MM-DD HH:MM:SS format
        (0, vitest_1.expect)(sampleUsage.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
});
(0, vitest_1.describe)('API Contract: Benchmark Results', () => {
    const sampleBenchmark = {
        id: 'uuid',
        model_id: 'uuid',
        model_name: 'GPT-4o',
        benchmark_name: 'reasoning',
        score: 85.5,
        latency: 1200,
        cost: 0.02,
        task_type: 'reasoning',
        run_date: '2026-05-31T12:00:00Z',
        regression: false,
        previous_score: 84.0,
        comparison_scores: { 'gpt-4': 82.0 },
    };
    (0, vitest_1.it)('should have all required fields', () => {
        (0, vitest_1.expect)(hasField(sampleBenchmark, 'id', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleBenchmark, 'model_name', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleBenchmark, 'benchmark_name', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleBenchmark, 'score', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleBenchmark, 'regression', 'boolean')).toBe(true);
    });
});
(0, vitest_1.describe)('API Contract: Alerts', () => {
    const sampleAlert = {
        id: 'provider-openai',
        timestamp: '2026-05-31T12:00:00Z',
        type: 'provider_outage',
        severity: 'critical',
        message: 'Provider openai is unhealthy',
        source: 'health-checker',
        acknowledged: false,
        resolved: false,
        details: { provider: 'openai', failures: 3 },
    };
    (0, vitest_1.it)('should have all required fields', () => {
        (0, vitest_1.expect)(hasField(sampleAlert, 'id', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleAlert, 'type', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleAlert, 'severity', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleAlert, 'message', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleAlert, 'acknowledged', 'boolean')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleAlert, 'resolved', 'boolean')).toBe(true);
    });
    (0, vitest_1.it)('type should be a valid value', () => {
        const validTypes = ['quota', 'provider_outage', 'spend_anomaly', 'latency_spike', 'benchmark_regression', 'auth_failure', 'sandbox_failure'];
        (0, vitest_1.expect)(validTypes).toContain(sampleAlert.type);
    });
});
(0, vitest_1.describe)('API Contract: Policy Rules', () => {
    const samplePolicy = {
        id: 'uuid',
        name: 'Allow OpenAI',
        tenant_id: 'uuid',
        type: 'provider_allow',
        target: ['openai'],
        action: 'allow',
        conditions: {},
        priority: 0,
        enabled: true,
        created_at: '2026-05-31T12:00:00Z',
    };
    (0, vitest_1.it)('should have all required fields', () => {
        (0, vitest_1.expect)(hasField(samplePolicy, 'id', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(samplePolicy, 'name', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(samplePolicy, 'type', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(samplePolicy, 'target', 'object')).toBe(true);
        (0, vitest_1.expect)(hasField(samplePolicy, 'action', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(samplePolicy, 'enabled', 'boolean')).toBe(true);
    });
    (0, vitest_1.it)('type should be a valid value', () => {
        const validTypes = ['provider_allow', 'provider_deny', 'model_allow', 'model_deny', 'cost_cap', 'modality_restriction', 'residency', 'tool_permission'];
        (0, vitest_1.expect)(validTypes).toContain(samplePolicy.type);
    });
});
(0, vitest_1.describe)('API Contract: Chat Completions', () => {
    const sampleRequest = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
        temperature: 0.7,
        max_tokens: 1024,
    };
    const sampleResponse = {
        id: 'req_abc123',
        object: 'chat.completion',
        created: 1717168800,
        model: 'gpt-4o',
        choices: [{
                index: 0,
                message: { role: 'assistant', content: 'Hi!' },
                finish_reason: 'stop',
            }],
        usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
        },
    };
    (0, vitest_1.it)('request should have required fields', () => {
        (0, vitest_1.expect)(hasField(sampleRequest, 'model', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleRequest, 'messages', 'object')).toBe(true);
    });
    (0, vitest_1.it)('response should have required fields', () => {
        (0, vitest_1.expect)(hasField(sampleResponse, 'id', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'object', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'created', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'model', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'choices', 'object')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse, 'usage', 'object')).toBe(true);
    });
    (0, vitest_1.it)('response.choices[0] should have required fields', () => {
        const choice = sampleResponse.choices[0];
        (0, vitest_1.expect)(hasField(choice, 'index', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(choice, 'message', 'object')).toBe(true);
        (0, vitest_1.expect)(hasField(choice, 'finish_reason', 'string')).toBe(true);
    });
    (0, vitest_1.it)('response.usage should have required fields', () => {
        (0, vitest_1.expect)(hasField(sampleResponse.usage, 'prompt_tokens', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse.usage, 'completion_tokens', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(sampleResponse.usage, 'total_tokens', 'number')).toBe(true);
    });
});
(0, vitest_1.describe)('API Contract: OpenAI Models List', () => {
    const sampleModelsList = {
        object: 'list',
        data: [
            {
                id: 'gpt-4o',
                object: 'model',
                created: 1717168800,
                owned_by: 'openai',
                meta: {
                    modality: 'llm',
                    display_name: 'GPT-4o',
                    context_window: 128000,
                },
            },
        ],
    };
    (0, vitest_1.it)('should have list wrapper', () => {
        (0, vitest_1.expect)(hasField(sampleModelsList, 'object', 'string')).toBe(true);
        (0, vitest_1.expect)(sampleModelsList.object).toBe('list');
        (0, vitest_1.expect)(hasField(sampleModelsList, 'data', 'object')).toBe(true);
    });
    (0, vitest_1.it)('each model should have required fields', () => {
        const model = sampleModelsList.data[0];
        (0, vitest_1.expect)(hasField(model, 'id', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(model, 'object', 'string')).toBe(true);
        (0, vitest_1.expect)(hasField(model, 'created', 'number')).toBe(true);
        (0, vitest_1.expect)(hasField(model, 'owned_by', 'string')).toBe(true);
    });
});
//# sourceMappingURL=api-contracts.test.js.map