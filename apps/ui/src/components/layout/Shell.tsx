import * as React from 'react';
import { Outlet, useLocation } from 'react-router';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { Toaster } from '@/components/primitives/Toast';
import { useUIStore } from '@/store/useUIStore';
import { useEffect } from 'react';

export function Shell() {
  const location = useLocation();
  const pushRecentPage = useUIStore((s) => s.pushRecentPage);

  useEffect(() => {
    pushRecentPage(location.pathname);
  }, [location.pathname, pushRecentPage]);

  return (
    <div className="flex h-dvh w-full min-w-0 overflow-hidden bg-bg text-fg">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-md focus:m-2"
      >
        Skip to content
      </a>
      <Sidebar />
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
