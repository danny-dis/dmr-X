import { StateCreator } from 'zustand';
import type {
  PlaygroundState,
  PlaygroundMode,
  PlaygroundConfig,
} from './usePlaygroundStore';

export interface UISlice {
  mode: PlaygroundMode;
  model: string;
  config: PlaygroundConfig;
  costFilter: 'all' | 'free';
  isTemporary: boolean;
  showSidebar: boolean;
  pendingPrompt: string;
  /** Top-level playground view — controls which full-page tab is shown. */
  activeTab: string;
  /** System prompt for chat mode (persisted). */
  systemPrompt: string;
  toggleTemporary: () => void;
  setMode: (mode: PlaygroundMode) => void;
  setModel: (model: string) => void;
  setCostFilter: (filter: 'all' | 'free') => void;
  setConfig: (config: Partial<PlaygroundConfig>) => void;
  setTools: (tools: any[]) => void;
  setGodmodeConfig: (godmode: Partial<PlaygroundConfig['godmode']>) => void;
  setShowSidebar: (show: boolean) => void;
  setPromptSeed: (prompt: string) => void;
  consumePromptSeed: () => string | null;
  setActiveTab: (tab: string) => void;
  setSystemPrompt: (prompt: string) => void;
}

export const createUISlice: StateCreator<PlaygroundState, [], [], UISlice> = (set, get) => ({
  mode: 'chat',
  model: 'auto',
  config: {
    temperature: 0.7,
    stream: true,
    tools: [],
    godmode: {
      autotune: true,
      parseltongue: true,
      parseltongueTechnique: 'leetspeak',
      parseltongueIntensity: 'medium',
      stmModules: ['hedge_reducer', 'direct_mode'],
    },
  },
  costFilter: 'all',
  isTemporary: false,
  showSidebar: true,
  pendingPrompt: '',
  activeTab: 'chat',
  systemPrompt: '',

  toggleTemporary: () => {
    set(state => ({ isTemporary: !state.isTemporary }));
  },

  setMode: (mode: PlaygroundMode) => {
    set({ mode, messages: [], currentConversationId: null });
  },

  setModel: (model: string) => {
    set({ model });
  },

  setCostFilter: (filter: 'all' | 'free') => {
    set({ costFilter: filter });
  },

  setConfig: (config: Partial<PlaygroundConfig>) => {
    set(state => ({ config: { ...state.config, ...config } }));
  },

  setTools: (tools: any[]) => {
    set(state => ({ config: { ...state.config, tools } }));
  },

  setGodmodeConfig: (godmode: Partial<PlaygroundConfig['godmode']>) => {
    set(state => ({
      config: {
        ...state.config,
        godmode: { ...state.config.godmode!, ...godmode },
      },
    }));
  },

  setShowSidebar: (show: boolean) => {
    set({ showSidebar: show });
  },

  setPromptSeed: (prompt: string) => {
    set({ pendingPrompt: prompt });
  },

  consumePromptSeed: () => {
    const { pendingPrompt } = get();
    if (!pendingPrompt) return null;
    set({ pendingPrompt: '' });
    return pendingPrompt;
  },

  setActiveTab: (tab: string) => {
    set({ activeTab: tab });
  },

  setSystemPrompt: (prompt: string) => {
    set({ systemPrompt: prompt });
  },
});
