import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import { Shell } from '../Shell';
import { useUIStore } from '@/store/useUIStore';

// Shell mounts a whole-app SSE subscription and topbar/palette queries.
// Neither is under test here — stub them so the layout suite stays focused
// and does not open network EventSources under the shared vitest fork.
vi.mock('@/hooks/useLiveStream', () => ({ useLiveStream: () => {} }));
vi.mock('@/lib/queries/dashboard', () => ({
  useHealth: () => ({ data: { status: 'ok' }, isError: false }),
}));
vi.mock('@/lib/queries/providers', () => ({ useProviders: () => ({ data: [] }) }));
vi.mock('@/lib/queries/models', () => ({ useModels: () => ({ data: [] }) }));

function mockViewport(isDesktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width: 1024px') ? isDesktop : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderShell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function sidebarWrapper(): HTMLElement {
  const wrapper = document.getElementById('mobile-navigation');
  if (!wrapper) throw new Error('sidebar wrapper #mobile-navigation not found');
  return wrapper;
}

beforeEach(() => {
  useUIStore.getState().reset();
  mockViewport(false); // mobile by default
});

describe('mobile navigation keyboard/focus (Phase 9)', () => {
  it('keeps the offscreen closed drawer out of the accessibility tree and tab order', async () => {
    renderShell();

    const wrapper = sidebarWrapper();
    // Closed mobile drawer is translated offscreen but stays mounted for the
    // CSS slide transition — it must still be inert/aria-hidden so keyboard
    // focus cannot land on invisible nav links.
    expect(wrapper).toHaveAttribute('inert');
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.getByRole('button', { name: 'Open menu' })
    ).toHaveAttribute('aria-expanded', 'false');
  }, 20_000);

  it('exposes the open drawer to keyboard users and marks the trigger expanded', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    const wrapper = sidebarWrapper();
    expect(wrapper).not.toHaveAttribute('inert');
    expect(wrapper).not.toHaveAttribute('aria-hidden');
    expect(
      screen.getByRole('button', { name: 'Open menu' })
    ).toHaveAttribute('aria-expanded', 'true');
  }, 20_000);

  it('closes the open mobile menu on Escape and returns focus to the hamburger', async () => {
    const user = userEvent.setup();
    renderShell();

    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await user.click(trigger);
    expect(useUIStore.getState().mobileMenuOpen).toBe(true);

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(useUIStore.getState().mobileMenuOpen).toBe(false);
    });
    expect(sidebarWrapper()).toHaveAttribute('inert');
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  }, 20_000);

  it('provides an accessible close control inside the open drawer', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    const close = await screen.findByRole('button', { name: 'Close menu' });
    expect(close).toBeVisible();

    await user.click(close);

    await waitFor(() => {
      expect(useUIStore.getState().mobileMenuOpen).toBe(false);
    });
    expect(sidebarWrapper()).toHaveAttribute('inert');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
    });
  }, 20_000);

  it('moves focus into the drawer close control when it opens', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    const close = await screen.findByRole('button', { name: 'Close menu' });
    await waitFor(() => {
      expect(close).toHaveFocus();
    });
  }, 20_000);

  it('traps Tab within the mobile dialog and makes the background inert', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));

    const dialog = screen.getByRole('dialog', { name: 'Main menu' });
    const close = screen.getByRole('button', { name: 'Close menu' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.getElementById('main-content')?.parentElement).toHaveAttribute('inert');
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    const last = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
    expect(last.length).toBeGreaterThan(0);
    expect(last[last.length - 1]).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    const backdrop = document.querySelector<HTMLElement>('[data-mobile-menu-backdrop]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(document.getElementById('main-content')?.parentElement).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
  }, 20_000);

  it('leaves the drawer focusable on desktop even while the mobile flag is closed', () => {
    mockViewport(true);
    renderShell();

    const wrapper = sidebarWrapper();
    expect(wrapper).not.toHaveAttribute('inert');
    expect(wrapper).not.toHaveAttribute('aria-hidden');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  }, 20_000);
});
