import { render, screen } from '@testing-library/react';
import { Outlet } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { Tooltip, TooltipTrigger } from '@/components/primitives/Tooltip';

vi.mock('@/components/layout', () => ({
  Shell: () => <Outlet />,
}));

vi.mock('@/pages/Dashboard', () => ({
  DashboardPage: () => (
    <Tooltip>
      <TooltipTrigger>Show route help</TooltipTrigger>
    </Tooltip>
  ),
}));

import App from './App';

describe('App providers', () => {
  it('provides tooltip context to the mounted dashboard route', async () => {
    window.history.replaceState({}, '', '/');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Show route help' })).toBeInTheDocument();
  });
});
