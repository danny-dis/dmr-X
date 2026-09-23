import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { HealthPage } from '../Health';

const mockUseHealth = vi.fn();
const mockUseProviders = vi.fn();

vi.mock('@/lib/queries/dashboard', () => ({
  useHealth: () => mockUseHealth(),
}));

vi.mock('@/lib/queries/providers', () => ({
  useProviders: () => mockUseProviders(),
}));

function mockProviderList() {
  mockUseProviders.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

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
    mockProviderList();
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
    mockProviderList();
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
    mockProviderList();
    renderHealth();
    expect(screen.getByText('operational')).toBeInTheDocument();
    expect(screen.getByText('Component checks unavailable')).toBeInTheDocument();
  });

  it('renders degraded status text', () => {
    mockUseHealth.mockReturnValue({
      data: { status: 'degraded' },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockProviderList();
    renderHealth();
    expect(screen.getAllByText('degraded').length).toBeGreaterThan(0);
  });

  it('renders measured provider counts and drilldown links', () => {
    mockUseHealth.mockReturnValue({
      data: { status: 'operational', version: '1.0.0', uptime: 7320 },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseProviders.mockReturnValue({
      data: [{ id: 'p1', name: 'OpenAI', tier: 'paid', status: 'healthy' }, { id: 'p2', name: 'Free', tier: 'inactive' }, { id: 'p3', name: 'Unavailable', tier: 'free', status: 'unavailable' }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderHealth();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('Version 1.0.0')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Requests' })).toHaveAttribute('href', '/requests');
    expect(screen.getByRole('link', { name: 'Performance' })).toHaveAttribute('href', '/performance');
    expect(screen.getByRole('link', { name: 'Costs' })).toHaveAttribute('href', '/cost');
    expect(screen.getByRole('link', { name: 'Providers' })).toHaveAttribute('href', '/providers');
  });

  it('renders component checks when the gateway provides them', () => {
    mockUseHealth.mockReturnValue({
      data: {
        status: 'degraded',
        checks: [{ name: 'db_read', status: 'ok' }, { name: 'candidates', status: 'fail', message: 'none loaded' }],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockProviderList();
    renderHealth();
    expect(screen.getByText('db_read')).toBeInTheDocument();
    expect(screen.getByText('candidates')).toBeInTheDocument();
  });
});
