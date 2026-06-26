import * as React from 'react';
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';

import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

import { Toaster } from '@/components/primitives/Toast';
import { useUIStore } from '@/store/useUIStore';

export function Shell() {
  const location = useLocation();
  const pushRecentPage = useUIStore((s) => s.pushRecentPage);
  const mobileMenuOpen = useUIStore((s) => s.mobileMenuOpen);
  const setMobileMenuOpen = useUIStore((s) => s.setMobileMenuOpen);

  useEffect(() => {
    pushRecentPage(location.pathname);
  }, [location.pathname, pushRecentPage]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, setMobileMenuOpen]);

  return (
    <div className="flex h-dvh w-full min-w-0 overflow-hidden bg-bg text-fg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-md focus:m-2"
      >
        Skip to content
      </a>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - always visible on desktop, slide-in on mobile */}
      <div className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 lg:relative lg:translate-x-0
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main id="main-content" className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
