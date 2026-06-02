import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'dark' | 'light';
export type SidebarDensity = 'comfortable' | 'compact';

export interface UIState {
  sidebarCollapsed: boolean;
  sidebarDensity: SidebarDensity;
  commandPaletteOpen: boolean;
  theme: ThemeMode;
  liveMode: boolean;
  favoriteProviders: string[];
  recentPages: { path: string; at: number }[];
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarDensity: (v: SidebarDensity) => void;
  setCommandPaletteOpen: (v: boolean) => void;
  setTheme: (v: ThemeMode) => void;
  setLiveMode: (v: boolean) => void;
  toggleFavoriteProvider: (id: string) => void;
  pushRecentPage: (path: string) => void;
  reset: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      sidebarDensity: 'comfortable',
      commandPaletteOpen: false,
      theme: 'dark',
      liveMode: true,
      favoriteProviders: [],
      recentPages: [],
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarDensity: (v) => set({ sidebarDensity: v }),
      setCommandPaletteOpen: (v) => set({ commandPaletteOpen: v }),
      setTheme: (v) => set({ theme: v }),
      setLiveMode: (v) => set({ liveMode: v }),
      toggleFavoriteProvider: (id) =>
        set((s) => ({
          favoriteProviders: s.favoriteProviders.includes(id)
            ? s.favoriteProviders.filter((x) => x !== id)
            : [...s.favoriteProviders, id],
        })),
      pushRecentPage: (path) =>
        set((s) => ({
          recentPages: [
            { path, at: Date.now() },
            ...s.recentPages.filter((p) => p.path !== path),
          ].slice(0, 10),
        })),
      reset: () =>
        set({
          sidebarCollapsed: false,
          sidebarDensity: 'comfortable',
          commandPaletteOpen: false,
          theme: 'dark',
          liveMode: true,
          favoriteProviders: [],
          recentPages: [],
        }),
    }),
    {
      name: 'dmrx-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarDensity: state.sidebarDensity,
        theme: state.theme,
        liveMode: state.liveMode,
        favoriteProviders: state.favoriteProviders,
      }),
    }
  )
);
