import { describe, it, expect, beforeEach } from 'vitest';

import { useUIStore } from './useUIStore';

// The store is a module-level singleton (zustand), so every test must reset
// it back to defaults first — `reset()` is the store's own action for this,
// which doubles as coverage for that action.
beforeEach(() => {
  useUIStore.getState().reset();
});

describe('useUIStore defaults', () => {
  it('starts with the documented default state', () => {
    const s = useUIStore.getState();
    expect(s.sidebarCollapsed).toBe(false);
    expect(s.sidebarDensity).toBe('comfortable');
    expect(s.commandPaletteOpen).toBe(false);
    expect(s.theme).toBe('dark');
    expect(s.liveMode).toBe(true);
    expect(s.mobileMenuOpen).toBe(false);
    expect(s.favoriteProviders).toEqual([]);
    expect(s.recentPages).toEqual([]);
  });
});

describe('simple setters', () => {
  it('setSidebarCollapsed sets the exact value given', () => {
    useUIStore.getState().setSidebarCollapsed(true);
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    useUIStore.getState().setSidebarCollapsed(false);
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it('toggleSidebar flips the current value each call', () => {
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it('setSidebarDensity switches between comfortable and compact', () => {
    useUIStore.getState().setSidebarDensity('compact');
    expect(useUIStore.getState().sidebarDensity).toBe('compact');
  });

  it('setCommandPaletteOpen sets the exact value given', () => {
    useUIStore.getState().setCommandPaletteOpen(true);
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it('setTheme switches between dark and light', () => {
    useUIStore.getState().setTheme('light');
    expect(useUIStore.getState().theme).toBe('light');
  });

  it('setLiveMode sets the exact value given', () => {
    useUIStore.getState().setLiveMode(false);
    expect(useUIStore.getState().liveMode).toBe(false);
  });

  it('setMobileMenuOpen sets the exact value given', () => {
    useUIStore.getState().setMobileMenuOpen(true);
    expect(useUIStore.getState().mobileMenuOpen).toBe(true);
  });
});

describe('toggleFavoriteProvider', () => {
  it('adds a provider id that is not yet a favorite', () => {
    useUIStore.getState().toggleFavoriteProvider('openai');
    expect(useUIStore.getState().favoriteProviders).toEqual(['openai']);
  });

  it('removes a provider id that is already a favorite', () => {
    useUIStore.getState().toggleFavoriteProvider('openai');
    useUIStore.getState().toggleFavoriteProvider('openai');
    expect(useUIStore.getState().favoriteProviders).toEqual([]);
  });

  it('tracks multiple favorites independently', () => {
    useUIStore.getState().toggleFavoriteProvider('openai');
    useUIStore.getState().toggleFavoriteProvider('anthropic');
    expect(useUIStore.getState().favoriteProviders).toEqual(['openai', 'anthropic']);
    useUIStore.getState().toggleFavoriteProvider('openai');
    expect(useUIStore.getState().favoriteProviders).toEqual(['anthropic']);
  });
});

describe('pushRecentPage', () => {
  it('adds a page to the front of the list', () => {
    useUIStore.getState().pushRecentPage('/dashboard');
    useUIStore.getState().pushRecentPage('/models');
    const paths = useUIStore.getState().recentPages.map((p) => p.path);
    expect(paths).toEqual(['/models', '/dashboard']);
  });

  it('deduplicates an existing path, moving it to the front instead of appending a second entry', () => {
    useUIStore.getState().pushRecentPage('/a');
    useUIStore.getState().pushRecentPage('/b');
    useUIStore.getState().pushRecentPage('/a');
    const paths = useUIStore.getState().recentPages.map((p) => p.path);
    expect(paths).toEqual(['/a', '/b']);
  });

  it('caps the list at 10 entries, dropping the oldest', () => {
    for (let i = 1; i <= 12; i++) {
      useUIStore.getState().pushRecentPage(`/p${i}`);
    }
    const paths = useUIStore.getState().recentPages.map((p) => p.path);
    expect(paths).toHaveLength(10);
    expect(paths[0]).toBe('/p12');
    expect(paths[9]).toBe('/p3');
    expect(paths).not.toContain('/p1');
    expect(paths).not.toContain('/p2');
  });

  it('records a numeric timestamp for each page', () => {
    useUIStore.getState().pushRecentPage('/x');
    expect(typeof useUIStore.getState().recentPages[0].at).toBe('number');
  });
});

describe('reset', () => {
  it('restores every field to its default after mutation', () => {
    const s = useUIStore.getState();
    s.setSidebarCollapsed(true);
    s.setSidebarDensity('compact');
    s.setCommandPaletteOpen(true);
    s.setTheme('light');
    s.setLiveMode(false);
    s.setMobileMenuOpen(true);
    s.toggleFavoriteProvider('openai');
    s.pushRecentPage('/somewhere');

    useUIStore.getState().reset();

    const after = useUIStore.getState();
    expect(after.sidebarCollapsed).toBe(false);
    expect(after.sidebarDensity).toBe('comfortable');
    expect(after.commandPaletteOpen).toBe(false);
    expect(after.theme).toBe('dark');
    expect(after.liveMode).toBe(true);
    expect(after.mobileMenuOpen).toBe(false);
    expect(after.favoriteProviders).toEqual([]);
    expect(after.recentPages).toEqual([]);
  });
});
