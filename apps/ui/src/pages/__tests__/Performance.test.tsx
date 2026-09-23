import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PerformancePage } from '../Performance';

const mockUseHealth = vi.fn();

vi.mock('@/lib/queries/dashboard', () => ({
  useHealth: () => mockUseHealth(),
}));

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

  it('renders latency cards and empty trend state on success', () => {
    mockUseHealth.mockReturnValue({
      data: { status: 'operational' },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPerformance();
    expect(screen.getByText('P50 Latency')).toBeInTheDocument();
    expect(screen.getByText('P95 Latency')).toBeInTheDocument();
    expect(screen.getByText('Throughput')).toBeInTheDocument();
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });
});
