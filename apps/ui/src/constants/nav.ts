import {
  Bot,
  Briefcase,
  Cpu,
  Layers,
  Network,
  Plug,
  ShoppingBag,
  Terminal,
  TrendingUp,
  Wallet,
  Activity,
  BarChart3,
  HeartPulse,
} from 'lucide-react';
import type { ComponentType } from 'react';

import * as SidebarIcons from '@/icons/SidebarIcons';

export interface NavItem {
  label: string;
  path: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  /** Rendered as a pill in the sidebar. Used for live counts. */
  badge?: string;
  description?: string;
  /**
   * Extra path prefixes this item owns, so a nested route keeps its parent
   * highlighted (e.g. /agents/new and /agents/:id both light up "Agents").
   */
  matches?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Home',
    items: [
      {
        label: 'Dashboard',
        path: '/',
        icon: SidebarIcons.OverviewIcon,
        description: 'Live overview & KPIs',
      },
    ],
  },
  {
    label: 'Build',
    items: [
      {
        label: 'Playground',
        path: '/playground/chat',
        icon: SidebarIcons.PlaygroundIcon,
        description: 'Chat, agents & godmode',
        matches: ['/playground'],
      },
      {
        label: 'Agents',
        path: '/agents',
        icon: Bot,
        description: 'Build, deploy & run agents',
        matches: ['/agents'],
      },
      {
        label: 'Runtime',
        path: '/runtime',
        icon: Cpu,
        description: 'Live agent instances & tasks',
      },
      {
        label: 'Jobs',
        path: '/jobs',
        icon: Briefcase,
        description: 'Multi-agent job board',
      },
    ],
  },
  {
    label: 'Route',
    items: [
      {
        label: 'Router',
        path: '/routing',
        icon: SidebarIcons.RoutingIcon,
        description: 'Decisions & strategies',
      },
      {
        label: 'Models',
        path: '/models',
        icon: SidebarIcons.ModelsIcon,
        description: 'Model registry & capabilities',
      },
      {
        label: 'Providers',
        path: '/providers',
        icon: SidebarIcons.ProvidersIcon,
        description: 'AI provider catalog',
      },
      {
        label: 'Policies',
        path: '/policies',
        icon: SidebarIcons.PoliciesIcon,
        description: 'Routing policies & rules',
      },
      {
        label: 'Free Inference',
        path: '/free-tier',
        icon: SidebarIcons.FreeTierIcon,
        description: 'Free models, usage & savings',
      },
    ],
  },
  {
    label: 'Observe',
    items: [
      {
        label: 'Requests',
        path: '/requests',
        icon: SidebarIcons.RequestsIcon,
        description: 'Live request stream',
      },
      {
        label: 'Performance',
        path: '/performance',
        icon: BarChart3,
        description: 'Latency & throughput',
      },
      {
        label: 'Costs',
        path: '/cost',
        icon: Wallet,
        description: 'Real-time cost tracking',
      },
      {
        label: 'Health',
        path: '/health',
        icon: HeartPulse,
        description: 'Gateway & provider health',
      },
    ],
  },
  {
    label: 'Connect',
    items: [
      {
        label: 'MCP',
        path: '/mcp',
        icon: Plug,
        description: 'Connect & discover MCP servers',
        matches: ['/mcp'],
      },
      {
        label: 'A2A',
        path: '/a2a',
        icon: Network,
        description: 'Agent-to-agent protocol',
      },
      {
        label: 'Integrations',
        path: '/integrations',
        icon: Terminal,
        description: 'Claude Code, Codex & more',
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        label: 'Settings',
        path: '/settings',
        icon: SidebarIcons.SettingsIcon,
        description: 'Configuration & API',
      },
    ],
  },
];

export interface BreadcrumbItem {
  label: string;
  path?: string;
}

/**
 * Resolve the nav item that owns a path.
 *
 * Prefers an exact match, then the longest `matches` prefix — so `/agents/new`
 * resolves to Agents rather than to whichever item happens to be checked
 * first, and `/agents/analytics` still wins over `/agents` because its exact
 * match is tried first.
 */
export function findNavItem(path: string): NavItem | undefined {
  const all = NAV_GROUPS.flatMap((g) => g.items);

  const exact = all.find((i) => i.path === path);
  if (exact) return exact;

  let best: NavItem | undefined;
  let bestLength = -1;
  for (const item of all) {
    for (const prefix of item.matches ?? []) {
      if ((path === prefix || path.startsWith(`${prefix}/`)) && prefix.length > bestLength) {
        best = item;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

export function findGroup(path: string): NavGroup | undefined {
  const item = findNavItem(path);
  if (!item) return undefined;
  return NAV_GROUPS.find((g) => g.items.includes(item));
}
