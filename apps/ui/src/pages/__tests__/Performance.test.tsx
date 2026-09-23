import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PerformancePage } from '../Performance';

const mockUseHealth = vi.fn();
const mockUseUsageHistory = vi.fn();
const mockUseDashboardStats = vi.fn();
const mockUseRouteDecisions = vi.fn();

vi.mock('@/lib/queries/dashboard', () => ({
  useHealth: () => mockUseHealth(),
  useUsageHistory: (...args: unknown[]) => mockUseUsageHistory(...args),
  useDashboardStats: () => mockUseDashboardStats(),
  useRouteDecisions: (...args: unknown[]) => mockUseRouteDecisions(...args),
}));

function mockMeasuredSources() {
  mockUseUsageHistory.mockReturnValue({
    data: { points: [], total: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseDashboardStats.mockReturnValue({
    data: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseRouteDecisions.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

function renderPerformance() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PerformancePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PerformancePage', () => {
  it('renders loading skeletons while health is loading', () => {
    mockUseHealth.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockMeasuredSources();
    renderPerformance();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders error state when query fails', () => {
    mockUseHealth.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: vi.fn(),
    });
    renderPerformance();
    expect(screen.getByText('Failed to load performance data')).toBeInTheDocument();
  });

  it('renders measured latency cards and empty trend state on success', () => {
    mockUseHealth.mockReturnValue({
      data: { status: 'operational' },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockMeasuredSources();
    renderPerformance();
    expect(screen.getByText('Avg latency')).toBeInTheDocument();
    expect(screen.getByText('Throughput')).toBeInTheDocument();
    expect(screen.getByText('Routing decisions')).toBeInTheDocument();
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('renders drilldown links to requests, routing, costs, and health', () => {
    mockUseHealth.mockReturnValue({
      data: { status: 'operational' },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockMeasuredSources();
    renderPerformance();
    expect(screen.getByRole('link', { name: 'Requests' })).toHaveAttribute('href', '/requests');
    expect(screen.getByRole('link', { name: 'Routing' })).toHaveAttribute('href', '/routing');
    expect(screen.getByRole('link', { name: 'Costs' })).toHaveAttribute('href', '/cost');
    expect(screen.getByRole('link', { name: 'Health' })).toHaveAttribute('href', '/health');
  });

  it('labels the dashboard latency as a calendar-day average', () => {
    mockUseHealth.mockReturnValue({ data: { status: 'operational' }, isLoading: false, isError: false, error: null });
    mockMeasuredSources();
    mockUseDashboardStats.mockReturnValue({ data: { avgLatencyMs: 123 }, isLoading: false, error: null });
    renderPerformance();
    expect(screen.getByText('Today (UTC) average end-to-end')).toBeInTheDocument();
    expect(screen.queryByText('24h average end-to-end')).not.toBeInTheDocument();
  });

  it('renders measured averages from usage history and decisions', () => {
    mockUseHealth.mockReturnValue({
      data: { status: 'operational' },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseUsageHistory.mockReturnValue({
      data: {
        points: [
          { t: 1, requests: 10, latency: 100 },
          { t: 2, requests: 20, latency: 200 },
        ],
        total: 2,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseDashboardStats.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseRouteDecisions.mockReturnValue({
      data: [{ latency: 150 }, { latency: 250 }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPerformance();
    // 30 requests total in window; avg bucket latency 150ms; avg decision 200ms
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
