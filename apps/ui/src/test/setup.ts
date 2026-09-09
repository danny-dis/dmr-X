import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom
// doesn't provide. Without it, any chart in a test throws
// "is not a constructor" and fails the whole suite.
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
globalThis.ResizeObserver = ResizeObserverMock;
window.ResizeObserver = ResizeObserverMock;

afterEach(() => {
  cleanup();
});
