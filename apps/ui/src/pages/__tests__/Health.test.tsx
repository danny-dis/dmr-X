import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { HealthPage } from '../Health';

const mockUseHealth = vi.fn();

vi.mock('@/lib/queries/dashboard', () => ({
  useHealth: () => mockUseHealth(),
}));

function renderHealth() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HealthPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('HealthPage', () => {
  it('renders loading skeletons while health is loading', () => {
    mockUseHealth.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderHealth();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders error state when health query fails', () => {
    mockUseHealth.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch: vi.fn(),
    });
    renderHealth();
    expect(screen.getByText('Failed to load health')).toBeInTheDocument();
  });

  it('renders status badge with tone mapping for operational gateway', () => {
    mockUseHealth.mockReturnValue({
      data: { status: 'operational' },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderHealth();
    expect(screen.getByText('operational')).toBeInTheDocument();
    expect(screen.getByText('All systems nominal')).toBeInTheDocument();
  });

  it('renders degraded status text', () => {
    mockUseHealth.mockReturnValue({
      data: { status: 'degraded' },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderHealth();
    expect(screen.getAllByText('degraded').length).toBeGreaterThan(0);
  });
});
