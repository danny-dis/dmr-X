import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';

const TABS = [
  { to: '/mcp', label: 'Servers', end: true },
  { to: '/mcp/discover', label: 'Discover' },
  { to: '/mcp/tools', label: 'Tools' },
  { to: '/mcp/settings', label: 'Settings' },
];

/**
 * MCP section tabs.
 *
 * Real routes rather than local tab state, so each view is linkable and the
 * back button works — the previous MCP page put eleven tabs behind
 * `defaultValue` with no URL representation, so a colleague could not be sent
 * to the one you were looking at.
 */
export function McpNav() {
  return (
    <nav className="mb-5 flex gap-1 border-b border-border" aria-label="MCP sections">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-fg-muted hover:text-fg',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
