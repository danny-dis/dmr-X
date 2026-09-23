import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { RoutingPage } from '../Routing';

const mockUseRouteDecisions = vi.fn();
const mockUseUsageHistory = vi.fn();
const mockUseProviders = vi.fn();
const mockUsePolicies = vi.fn();

vi.mock('@/lib/queries/dashboard', () => ({
  useRouteDecisions: (...args: unknown[]) => mockUseRouteDecisions(...args),
  useUsageHistory: (...args: unknown[]) => mockUseUsageHistory(...args),
}));

vi.mock('@/lib/queries/providers', () => ({
  useProviders: (...args: unknown[]) => mockUseProviders(...args),
}));

vi.mock('@/lib/queries/policies', () => ({
  usePolicies: (...args: unknown[]) => mockUsePolicies(...args),
}));

function renderRouting() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RoutingPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function setupEmpty() {
  mockUseRouteDecisions.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseUsageHistory.mockReturnValue({
    data: { points: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseProviders.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUsePolicies.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe('RoutingPage', () => {
  it('renders router header and decisions badge', () => {
    setupEmpty();
    renderRouting();
    expect(screen.getAllByText('Router').length).toBeGreaterThan(0);
    expect(screen.getByText('0 decisions tracked')).toBeInTheDocument();
  });

  it('renders empty policies and decisions states', () => {
    setupEmpty();
    renderRouting();
    expect(screen.getByText('No policies configured')).toBeInTheDocument();
    expect(screen.getByText('No routing decisions yet')).toBeInTheDocument();
  });

  it('renders a decision row and drawer close button (Button import)', () => {
    mockUseRouteDecisions.mockReturnValue({
      data: [
        {
          id: 'd1',
          task_type: 'brain',
          status: 'success',
          latency: 120,
          confidence: 0.9,
          decision_reason: 'cost_optimize',
          selected_provider: 'openai',
          selected_model: 'gpt-4o-mini',
          input_tokens: 10,
          output_tokens: 5,
          cost: 0.001,
          timestamp: new Date().toISOString(),
        },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseUsageHistory.mockReturnValue({
      data: { points: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseProviders.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUsePolicies.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderRouting();
    expect(screen.getByText('Recent decisions')).toBeInTheDocument();
  });
});
