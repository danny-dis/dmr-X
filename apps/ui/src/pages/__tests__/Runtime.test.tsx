import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { RuntimePage } from '../Runtime';

const mockUseHealth = vi.fn();
const mockUseAgentInstances = vi.fn();
const mockUseAgentExecutions = vi.fn();
const mockUseAgentSteps = vi.fn();
const mockUseDeleteInstance = vi.fn();
const mockUseSetInstanceRunning = vi.fn();

vi.mock('@/lib/queries/dashboard', () => ({
  useHealth: () => mockUseHealth(),
}));

vi.mock('@/lib/queries/agents', () => ({
  useAgentExecutions: (...args: unknown[]) => mockUseAgentExecutions(...args),
  useAgentInstances: () => mockUseAgentInstances(),
  useAgentSteps: (...args: unknown[]) => mockUseAgentSteps(...args),
  useDeleteInstance: () => mockUseDeleteInstance(),
  useSetInstanceRunning: () => mockUseSetInstanceRunning(),
}));

vi.mock('@/store/useLiveStore', () => ({
  useLiveStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ stats: null, connection: 'open', events: [], decisions: [] }),
}));

function renderRuntime() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RuntimePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const instanceItem = {
  id: 'inst-1',
  agentDefinitionId: 'a1',
  tenantId: 't1',
  status: 'active',
  configOverride: {},
  createdAt: '2024-06-01T10:00:00Z',
  updatedAt: '2024-06-01T10:00:00Z',
  definitionName: 'Test Agent',
  definitionHumanName: 'Test Agent',
  definitionDescription: null,
  definitionCategory: null,
  definitionIcon: null,
  definitionModelTier: 'default',
  executionCount: 2,
  lastExecutionAt: '2024-06-01T11:00:00Z',
  costCents24h: 150,
};

function setupBase() {
  mockUseHealth.mockReturnValue({
    data: { status: 'operational' },
    isLoading: false,
  });
  mockUseAgentInstances.mockReturnValue({
    data: { items: [instanceItem], total: 1 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseDeleteInstance.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseSetInstanceRunning.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseAgentExecutions.mockReturnValue({
    data: [
      {
        id: 'exec-1',
        agentInstanceId: 'inst-1',
        input: 'hello',
        output: 'world',
        toolsUsed: [],
        modelUsed: 'gpt-4o-mini',
        inputTokens: 10,
        outputTokens: 5,
        costCents: 12,
        durationMs: 120,
        status: 'completed',
        error: null,
        createdAt: new Date().toISOString(),
      },
    ],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseAgentSteps.mockReturnValue({
    data: { items: [], total: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe('RuntimePage', () => {
  it('renders runtime header and instance card', () => {
    setupBase();
    renderRuntime();
    expect(screen.getAllByText('Runtime').length).toBeGreaterThan(0);
    expect(screen.getByText('Test Agent')).toBeInTheDocument();
  });

  it('renders empty instances state when none exist', () => {
    setupBase();
    mockUseAgentInstances.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderRuntime();
    expect(screen.getByText('No instances running')).toBeInTheDocument();
  });

  it('expands trace and renders executions via useAgentExecutions', async () => {
    setupBase();
    renderRuntime();
    fireEvent.click(screen.getByText('Trace'));
    await waitFor(() => {
      expect(mockUseAgentExecutions).toHaveBeenCalled();
      expect(screen.getByText('hello')).toBeInTheDocument();
    });
  });
});
