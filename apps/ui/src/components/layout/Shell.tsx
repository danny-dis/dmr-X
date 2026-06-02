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
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
