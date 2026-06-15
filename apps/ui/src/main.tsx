import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import App from './App';
import { useUIStore } from './store/useUIStore';
import './index.css';

/**
 * `<ThemeSync />` is mounted at the root (outside <App/>) so the dark class
 * stays in sync with the persisted theme on every store change, including
 * the very first render. The Topbar's switcher calls `setTheme`; this
 * effect applies the matching class on <html> so CSS variables in
 * `index.css` resolve to the right palette.
 */
function ThemeSync() {
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    // Update the mobile address-bar color to match. Safari and Chrome both
    // read this tag at every navigation, so it tracks the theme live.
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) {
      meta.content = theme === 'dark' ? '#0A0B10' : '#F7F8FB';
    }
  }, [theme]);

  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipPrimitive.Provider delayDuration={150} skipDelayDuration={300}>
      <ThemeSync />
      <App />
    </TooltipPrimitive.Provider>
  </StrictMode>
);
