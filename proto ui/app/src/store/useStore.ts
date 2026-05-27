import { create } from 'zustand';
import type { RouteDecision, Model, Provider, Alert } from '@/types';

interface AppState {
  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Current page
  currentPage: string;
  setCurrentPage: (page: string) => void;

  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // Detail drawer
  drawerOpen: boolean;
  drawerType: string | null;
  drawerData: unknown;
  openDrawer: (type: string, data: unknown) => void;
  closeDrawer: () => void;

  // Filters
  filterTaskType: string | null;
  setFilterTaskType: (type: string | null) => void;
  filterStatus: string | null;
  setFilterStatus: (status: string | null) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Selection
  selectedRoute: RouteDecision | null;
  setSelectedRoute: (route: RouteDecision | null) => void;
  selectedModel: Model | null;
  setSelectedModel: (model: Model | null) => void;
  selectedProvider: Provider | null;
  setSelectedProvider: (provider: Provider | null) => void;

  // Alerts
  alerts: Alert[];
  acknowledgeAlert: (id: string) => void;

  // Loading
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  currentPage: 'overview',
  setCurrentPage: (page) => set({ currentPage: page }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  drawerOpen: false,
  drawerType: null,
  drawerData: null,
  openDrawer: (type, data) => set({ drawerOpen: true, drawerType: type, drawerData: data }),
  closeDrawer: () => set({ drawerOpen: false, drawerType: null, drawerData: null }),

  filterTaskType: null,
  setFilterTaskType: (type) => set({ filterTaskType: type }),
  filterStatus: null,
  setFilterStatus: (status) => set({ filterStatus: status }),
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),

  selectedRoute: null,
  setSelectedRoute: (route) => set({ selectedRoute: route }),
  selectedModel: null,
  setSelectedModel: (model) => set({ selectedModel: model }),
  selectedProvider: null,
  setSelectedProvider: (provider) => set({ selectedProvider: provider }),

  alerts: [],
  acknowledgeAlert: (id) => set((state) => ({
    alerts: state.alerts.map((a) => a.id === id ? { ...a, acknowledged: true } : a),
  })),

  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
}));
