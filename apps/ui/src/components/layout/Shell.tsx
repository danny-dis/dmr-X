import * as React from 'react';
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';

import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

import { Toaster } from '@/components/primitives/Toast';
import { useLiveStream } from '@/hooks/useLiveStream';
import { useMediaQuery } from '@/hooks/useMisc';
import { useUIStore } from '@/store/useUIStore';

export function Shell() {
  const location = useLocation();

  // One SSE subscription for the whole app, feeding useLiveStore. Pages read
  // from the store rather than each opening their own stream or poll loop.
  useLiveStream();

  const pushRecentPage = useUIStore((s) => s.pushRecentPage);
  const mobileMenuOpen = useUIStore((s) => s.mobileMenuOpen);
  const setMobileMenuOpen = useUIStore((s) => s.setMobileMenuOpen);
  // Desktop keeps the sidebar always mounted/visible (lg:relative lg:translate-x-0);
  // only the mobile offscreen drawer needs inert/Escape/focus management.
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const sidebarRef = React.useRef<HTMLDivElement>(null);
  const wasMobileMenuOpen = React.useRef(false);

  useEffect(() => {
    pushRecentPage(location.pathname);
  }, [location.pathname, pushRecentPage]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, setMobileMenuOpen]);

  // Keep keyboard focus inside the mobile dialog until it closes.
  useEffect(() => {
    if (!mobileMenuOpen || isDesktop) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        sidebarRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!sidebarRef.current?.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen, isDesktop, setMobileMenuOpen]);

  // Focus management: move focus into the drawer when it opens on mobile;
  // return focus to the Topbar hamburger when it closes again.
  useEffect(() => {
    if (mobileMenuOpen && !isDesktop) {
      wasMobileMenuOpen.current = true;
      const closeButton = sidebarRef.current?.querySelector<HTMLElement>(
        '[data-mobile-menu-close]'
      );
      closeButton?.focus();
      return;
    }
    if (wasMobileMenuOpen.current && !mobileMenuOpen && !isDesktop) {
      wasMobileMenuOpen.current = false;
      document.querySelector<HTMLElement>('[data-mobile-menu-trigger]')?.focus();
      return;
    }
    if (isDesktop) wasMobileMenuOpen.current = false;
  }, [mobileMenuOpen, isDesktop]);

  // Closed-on-mobile drawer stays mounted for the slide transition but must
  // not remain keyboard-focusable or exposed to assistive tech offscreen.
  const sidebarOffscreen = !isDesktop && !mobileMenuOpen;

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
          data-mobile-menu-backdrop=""
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - always visible on desktop, slide-in on mobile */}
      <div
        ref={sidebarRef}
        id="mobile-navigation"
        role={mobileMenuOpen && !isDesktop ? 'dialog' : undefined}
        aria-modal={mobileMenuOpen && !isDesktop ? true : undefined}
        aria-label={mobileMenuOpen && !isDesktop ? 'Main menu' : undefined}
        tabIndex={-1}
        inert={sidebarOffscreen || undefined}
        aria-hidden={sidebarOffscreen || undefined}
        className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 lg:relative lg:translate-x-0
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}
      >
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col min-w-0" inert={mobileMenuOpen && !isDesktop || undefined}>
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
