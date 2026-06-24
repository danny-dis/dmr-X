import type { UnifiedRequest, UnifiedResponse, ProviderModel } from '@dmr-x/core';
import { describe, it, expect, vi } from 'vitest';

import { CompositeExecutor } from '../../services/router/src/decomposer/composite-executor.js';
import { SpecialistRouter } from '../../services/router/src/decomposer/specialist-router.js';
import { TaskDecomposer } from '../../services/router/src/decomposer/task-decomposer.js';
import type {
  SubTask,
  DecomposedTask,
} from '../../services/router/src/decomposer/task-decomposer.js';
import type { WorkerPoolFanout } from '../../services/router/src/decomposer/worker-pool-fanout.js';
import type { AdapterExecutor } from '../../services/router/src/fallback/fallback-executor.js';

function makeMockAdapterExecutor(
  responses: Record<string, string>,
  delayMs = 1,
): AdapterExecutor {
  return {
    async execute(providerId: string, modelId: string, _request: UnifiedRequest) {
      await new Promise((r) => setTimeout(r, delayMs));
      const content = responses[`${providerId}/${modelId}`] ?? `default-${providerId}/${modelId}`;
      return {
        modality: 'llm',
        requestId: `req_${providerId}_${modelId}`,
        providerId,
        modelId,
        message: { role: 'assistant', content },
        latencyMs: delayMs,
      } satisfies UnifiedResponse;
    },
  };
}

function makeMockWorkerPool(): {
  fanout: WorkerPoolFanout;
  runParallelSpy: ReturnType<typeof vi.fn>;
} {
  const runParallelSpy = vi.fn();
  // Minimal shape that satisfies CompositeExecutor's optional workerPool param.
  const fanout = {
    runParallel: runParallelSpy.mockImplementation(
      async (
        subTasks: SubTask[],
        _assignments: Map<string, ProviderModel>,
        buildRequest: (s: SubTask) => UnifiedRequest,
      ) => {
        const results = new Map<string, any>();
        for (const t of subTasks) {
          const req = buildRequest(t);
          results.set(t.id, {
            subTaskId: t.id,
            response: {
              modality: 'llm',
              requestId: `wpf_${t.id}`,
              providerId: 'mock',
              modelId: 'mock',
              message: { role: 'assistant', content: `fanout:${t.id}` },
              latencyMs: 0,
            } satisfies UnifiedResponse,
            modelId: 'mock',
            providerId: 'mock',
            executionTimeMs: 0,
            success: true,
          });
        }
        return results;
      },
    ),
    shutdown: () => {},
  } as unknown as WorkerPoolFanout;
  return { fanout, runParallelSpy };
}

describe('CompositeExecutor + WorkerPoolFanout integration', () => {
  it('uses the injected WorkerPoolFanout for parallel groups', async () => {
    const adapter = makeMockAdapterExecutor({});
    const { fanout, runParallelSpy } = makeMockWorkerPool();
    const composite = new CompositeExecutor(new SpecialistRouter(), adapter, fanout);

    // Build a DecomposedTask with a single parallel group of 3 sub-tasks.
    const subTasks: SubTask[] = [
      { id: 's1', description: 'task 1', specializations: ['backend_api'], dependsOn: [], estimatedTokens: 100, priority: 1, canParallel: true, modality: 'llm' },
      { id: 's2', description: 'task 2', specializations: ['data_modeling'], dependsOn: [], estimatedTokens: 100, priority: 1, canParallel: true, modality: 'llm' },
      { id: 's3', description: 'task 3', specializations: ['documentation'], dependsOn: [], estimatedTokens: 100, priority: 1, canParallel: true, modality: 'llm' },
    ];
    const decomposed: DecomposedTask = {
      id: 't1',
      originalPrompt: 'multi-task prompt',
      subTasks,
      executionPlan: {
        groups: [{ id: 'g1', subTaskIds: ['s1', 's2', 's3'], type: 'parallel' }],
        totalEstimatedTokens: 300,
        estimatedDurationMs: 1000,
      },
      requiresOrchestration: true,
    };

    // Fake assignments so each sub-task looks like it has a provider/model.
    const assignments = new Map<string, ProviderModel>([
      ['s1', { providerId: 'p1', providerName: 'p1', modelId: 'm1' } as ProviderModel],
      ['s2', { providerId: 'p1', providerName: 'p1', modelId: 'm1' } as ProviderModel],
      ['s3', { providerId: 'p1', providerName: 'p1', modelId: 'm1' } as ProviderModel],
    ]);

    // We bypass SpecialistRouter.routeAllSubTasks by stubbing it.
    const specialistRouter = (composite as any).specialistRouter as SpecialistRouter;
    vi.spyOn(specialistRouter, 'routeAllSubTasks').mockReturnValue(assignments);

    const request: UnifiedRequest = {
      modality: 'llm',
      messages: [{ role: 'user', content: 'big composite prompt that mentions backend and frontend and database' }],
      stream: false,
      metadata: {},
    };

    const result = await composite.execute(decomposed, [], request);

    // 1) The fanout was invoked exactly once (for the single parallel group)
    expect(runParallelSpy).toHaveBeenCalledTimes(1);

    // 2) The fanout was given all 3 sub-tasks
    const call = runParallelSpy.mock.calls[0];
    expect(call[0]).toHaveLength(3);
    expect(call[0].map((s: SubTask) => s.id).sort()).toEqual(['s1', 's2', 's3']);

    // 3) All 3 sub-tasks are present in the result
    expect(result.subTaskResults.size).toBe(3);
    expect(result.subTaskResults.get('s1')?.success).toBe(true);
    expect(result.subTaskResults.get('s2')?.success).toBe(true);
    expect(result.subTaskResults.get('s3')?.success).toBe(true);
    expect(result.subTaskResults.get('s1')?.response.message?.content).toBe('fanout:s1');

    // 4) The aggregated response contains all 3 sub-task outputs
    expect(result.aggregatedResponse.message?.content).toContain('fanout:s1');
    expect(result.aggregatedResponse.message?.content).toContain('fanout:s2');
    expect(result.aggregatedResponse.message?.content).toContain('fanout:s3');
  });

  it('falls back to in-process execution when no WorkerPoolFanout is injected', async () => {
    const adapter = makeMockAdapterExecutor({ 'p1/m1': 'plain-exec' });
    const composite = new CompositeExecutor(new SpecialistRouter(), adapter); // no fanout

    const subTasks: SubTask[] = [
      { id: 'a', description: 'A', specializations: ['backend_api'], dependsOn: [], estimatedTokens: 100, priority: 1, canParallel: true, modality: 'llm' },
      { id: 'b', description: 'B', specializations: ['backend_api'], dependsOn: [], estimatedTokens: 100, priority: 1, canParallel: true, modality: 'llm' },
    ];
    const decomposed: DecomposedTask = {
      id: 't2',
      originalPrompt: 'simple',
      subTasks,
      executionPlan: {
        groups: [{ id: 'g1', subTaskIds: ['a', 'b'], type: 'parallel' }],
        totalEstimatedTokens: 200,
        estimatedDurationMs: 500,
      },
      requiresOrchestration: false,
    };

    const assignments = new Map<string, ProviderModel>([
      ['a', { providerId: 'p1', providerName: 'p1', modelId: 'm1' } as ProviderModel],
      ['b', { providerId: 'p1', providerName: 'p1', modelId: 'm1' } as ProviderModel],
    ]);
    const specialistRouter = (composite as any).specialistRouter as SpecialistRouter;
    vi.spyOn(specialistRouter, 'routeAllSubTasks').mockReturnValue(assignments);

    const request: UnifiedRequest = {
      modality: 'llm',
      messages: [{ role: 'user', content: 'a plain prompt' }],
      stream: false,
      metadata: {},
    };

    const result = await composite.execute(decomposed, [], request);

    expect(result.subTaskResults.size).toBe(2);
    expect(result.subTaskResults.get('a')?.response.message?.content).toBe('plain-exec');
    expect(result.subTaskResults.get('b')?.response.message?.content).toBe('plain-exec');
  });
});
