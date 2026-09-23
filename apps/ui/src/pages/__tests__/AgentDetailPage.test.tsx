import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AgentDetailPage } from '../agents/AgentDetailPage';

const mockUseAgent = vi.fn();
const mockUseAgentInstancesFor = vi.fn();
const mockUseDeleteAgent = vi.fn();
const mockUseDeployAgent = vi.fn();
const mockUsePublishAgent = vi.fn();
const mockUseUpdateAgent = vi.fn();
const mockUseSetInstanceRunning = vi.fn();
const mockUseDeleteInstance = vi.fn();
const mockUseMemoryItems = vi.fn();
const mockUseMemoryStats = vi.fn();
const mockUseSearchMemory = vi.fn();

vi.mock('@/lib/queries/agents', () => ({
  useAgent: (...args: unknown[]) => mockUseAgent(...args),
  useAgentInstancesFor: (...args: unknown[]) => mockUseAgentInstancesFor(...args),
  useDeleteAgent: () => mockUseDeleteAgent(),
  useDeployAgent: () => mockUseDeployAgent(),
  usePublishAgent: () => mockUsePublishAgent(),
  useUpdateAgent: () => mockUseUpdateAgent(),
  useSetInstanceRunning: () => mockUseSetInstanceRunning(),
  useDeleteInstance: () => mockUseDeleteInstance(),
}));

vi.mock('@/lib/queries/memory', () => ({
  useMemoryItems: (...args: unknown[]) => mockUseMemoryItems(...args),
  useMemoryStats: (...args: unknown[]) => mockUseMemoryStats(...args),
  useSearchMemory: () => mockUseSearchMemory(),
}));

const agentDef = {
  id: 'a1',
  tenantId: 't1',
  name: 'research-bot',
  humanName: 'Research Bot',
  description: 'Helps with research',
  version: '1',
  systemPrompt: 'You are helpful.',
  personality: null,
  preferredModel: null,
  modelTier: 'auto',
  allowedTools: [],
  customTools: [],
  workflow: null,
  triggers: [],
  visibility: 'private',
  tags: [],
  category: 'research',
  icon: null,
  planMode: false,
  historyCompaction: false,
  verifyOnStop: false,
  publishedAt: null,
  createdAt: '2024-06-01T10:00:00Z',
  updatedAt: '2024-06-01T10:00:00Z',
};

function renderDetail(initialEntries: string[] = ['/agents/a1']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/agents/:id" element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function setupMocks(overrides: {
  agent?: Record<string, unknown>;
  instances?: Record<string, unknown>;
} = {}) {
  mockUseAgent.mockReturnValue({
    data: agentDef,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides.agent,
  });
  mockUseAgentInstancesFor.mockReturnValue({
    data: { items: [], total: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides.instances,
  });
  mockUseDeleteAgent.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseDeployAgent.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUsePublishAgent.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseUpdateAgent.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseSetInstanceRunning.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseDeleteInstance.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseMemoryItems.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseMemoryStats.mockReturnValue({
    data: {},
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseSearchMemory.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
}

describe('AgentDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('renders the agent header from the detail query', () => {
    renderDetail();
    expect(screen.getByRole('heading', { name: 'Research Bot' })).toBeInTheDocument();
    expect(screen.getByText('Helps with research')).toBeInTheDocument();
  });

  it('links back to the agent list', () => {
    renderDetail();
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '/agents');
  });

  it('renders overview configuration from the real definition', () => {
    renderDetail();
    expect(screen.getByText('Model tier')).toBeInTheDocument();
    expect(screen.getByText('You are helpful.')).toBeInTheDocument();
  });

  it('renders the detail tabs wired to the router', () => {
    renderDetail();
    expect(screen.getByRole('tab', { name: /Overview/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Instances/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Runs/ })).toBeInTheDocument();
  });

  it('renders the deploy action for the loaded agent', () => {
    renderDetail();
    expect(screen.getByText('Deploy instance')).toBeInTheDocument();
  });

  it('renders loading skeletons while the detail is loading', () => {
    setupMocks({ agent: { data: undefined, isLoading: true } });
    renderDetail();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders the not-found empty state when the agent is missing', () => {
    setupMocks({ agent: { data: undefined, isLoading: false, error: null } });
    renderDetail();
    expect(screen.getByText('Agent not found')).toBeInTheDocument();
  });

  it('renders the error state when the detail query fails', () => {
    setupMocks({ agent: { data: undefined, isLoading: false, error: new Error('boom') } });
    renderDetail();
    expect(screen.getByText("Can't reach the gateway")).toBeInTheDocument();
  });
});
