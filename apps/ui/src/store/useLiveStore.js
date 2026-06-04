import { create } from 'zustand';
const MAX_EVENTS = 500;
export const useLiveStore = create((set) => ({
    events: [],
    decisions: [],
    alerts: [],
    rate: 0,
    lastEventAt: null,
    paused: false,
    pushTelemetry: (e) => set((s) => ({
        events: [e, ...s.events].slice(0, MAX_EVENTS),
        lastEventAt: Date.now(),
    })),
    pushDecision: (d) => set((s) => ({
        decisions: [d, ...s.decisions].slice(0, 200),
    })),
    pushAlert: (a) => set((s) => ({
        alerts: [a, ...s.alerts].slice(0, 100),
    })),
    setRate: (rate) => set({ rate }),
    clear: () => set({ events: [], decisions: [], lastEventAt: null }),
    setPaused: (paused) => set({ paused }),
}));
//# sourceMappingURL=useLiveStore.js.map