import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import { Sidebar } from '../Sidebar';
import { TooltipProvider } from '@/components/primitives/Tooltip';
import { useUIStore } from '@/store/useUIStore';

beforeEach(() => {
  useUIStore.getState().reset();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe('Sidebar on mobile', () => {
  it('shows labeled destinations rather than an icon-only rail', () => {
    useUIStore.getState().setSidebarCollapsed(true);
    render(<TooltipProvider><MemoryRouter initialEntries={['/']}><Sidebar /></MemoryRouter></TooltipProvider>);

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Agents' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Runtime' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Router' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Free Inference' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Requests' })).toBeVisible();
  }, 20_000);
});
