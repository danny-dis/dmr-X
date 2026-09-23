import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AgentsPage } from '../agents/AgentsPage';
import { TooltipProvider } from '@/components/primitives/Tooltip';

const mockUseAgents = vi.fn();
const mockUseAgentInstances = vi.fn();
const mockUseDeleteAgent = vi.fn();
const mockUseDeployAgent = vi.fn();
const mockUseSetInstanceRunning = vi.fn();
const mockUseMcpServers = vi.fn();

vi.mock('@/lib/queries/agents', () => ({
  useAgents: (...args: unknown[]) => mockUseAgents(...args),
  useAgentInstances: (...args: unknown[]) => mockUseAgentInstances(...args),
  useDeleteAgent: () => mockUseDeleteAgent(),
  useDeployAgent: () => mockUseDeployAgent(),
  useSetInstanceRunning: () => mockUseSetInstanceRunning(),
}));

vi.mock('@/lib/queries/mcp', () => ({
  useMcpServers: () => mockUseMcpServers(),
}));

const agentA = {
  id: 'a1',
  tenantId: 't1',
  name: 'research-bot',
  humanName: 'Research Bot',
  description: 'Helps with research',
  version: '1',
  systemPrompt: null,
  personality: null,
  preferredModel: null,
  modelTier: 'auto',
  allowedTools: ['search'],
  customTools: [],
  workflow: null,
  triggers: [],
  visibility: 'private',
  tags: [],
  category: 'research',
  icon: null,
  publishedAt: null,
  createdAt: '2024-06-01T10:00:00Z',
  updatedAt: '2024-06-01T10:00:00Z',
};

const activeInstance = {
  id: 'i1',
  agentDefinitionId: 'a1',
  tenantId: 't1',
  status: 'active',
  configOverride: {},
  createdAt: '2024-06-01T10:00:00Z',
  updatedAt: '2024-06-01T10:00:00Z',
  definitionName: 'research-bot',
  definitionHumanName: 'Research Bot',
  definitionDescription: null,
  definitionCategory: null,
  definitionIcon: null,
  definitionModelTier: null,
  executionCount: 3,
  lastExecutionAt: null,
  costCents24h: 50,
};

function renderAgents(initialEntries: string[] = ['/agents']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <AgentsPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function setupMocks(overrides: {
  agents?: Record<string, unknown>;
  instances?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
} = {}) {
  mockUseAgents.mockReturnValue({
    data: { items: [agentA], total: 1 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides.agents,
  });
  mockUseAgentInstances.mockReturnValue({
    data: { items: [], total: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides.instances,
  });
  mockUseMcpServers.mockReturnValue({
    data: { servers: [], total: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides.mcp,
  });
  mockUseDeleteAgent.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseDeployAgent.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseSetInstanceRunning.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

describe('AgentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('renders the page header and agent card', () => {
    renderAgents();
    expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByText('Research Bot')).toBeInTheDocument();
  });

  it('links each card to its detail route (list -> detail)', () => {
    renderAgents();
    const link = screen.getByRole('link', { name: /Research Bot/ });
    expect(link).toHaveAttribute('href', '/agents/a1');
  });

  it('links the New agent button to the create route', () => {
    renderAgents();
    expect(screen.getByRole('link', { name: /New agent/ })).toHaveAttribute('href', '/agents/new');
  });

  it('renders loading skeletons while the list is loading', () => {
    setupMocks({ agents: { data: undefined, isLoading: true } });
    renderAgents();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders the empty state when no agents exist', () => {
    setupMocks({ agents: { data: { items: [], total: 0 } } });
    renderAgents();
    expect(screen.getByText('No agents yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create your first agent/ })).toHaveAttribute(
      'href',
      '/agents/new'
    );
  });

  it('renders the search empty state when the query matches nothing', () => {
    setupMocks({ agents: { data: { items: [], total: 0 } } });
    renderAgents(['/agents?q=zzz']);
    expect(screen.getByText(/No agent matches/)).toBeInTheDocument();
  });

  it('renders the error state when the list query fails', () => {
    setupMocks({ agents: { data: undefined, isLoading: false, error: new Error('boom') } });
    renderAgents();
    expect(screen.getByText("Can't reach the gateway")).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  it('shows Not deployed when the agent has no instances', () => {
    renderAgents();
    expect(screen.getByText('Not deployed')).toBeInTheDocument();
    expect(screen.getByText('Deploy')).toBeInTheDocument();
  });

  it('shows the live pill and Chat action when an instance is active', () => {
    setupMocks({ instances: { data: { items: [activeInstance], total: 1 } } });
    renderAgents();
    expect(screen.getByText('1 live')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
  });
});
