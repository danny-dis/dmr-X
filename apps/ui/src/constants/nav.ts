import {
  Bot,
  Cpu,
  Layers,
  Network,
  Plug,
  ShoppingBag,
  Terminal,
  TrendingUp,
  Wallet,
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
    label: 'Overview',
    items: [
      {
        label: 'Dashboard',
        path: '/',
        icon: SidebarIcons.OverviewIcon,
        description: 'Live overview & KPIs',
      },
      {
        label: 'Playground',
        path: '/playground/chat',
        icon: SidebarIcons.PlaygroundIcon,
        description: 'Chat, agents & godmode',
        matches: ['/playground'],
      },
    ],
  },
  {
    label: 'Traffic',
    items: [
      {
        label: 'Requests',
        path: '/requests',
        icon: SidebarIcons.RequestsIcon,
        description: 'Live request stream',
      },
      {
        label: 'Routing',
        path: '/routing',
        icon: SidebarIcons.RoutingIcon,
        description: 'Decisions & strategies',
      },
      {
        label: 'Fusion Panel',
        path: '/fusion',
        icon: Layers,
        description: 'Multi-model diversity',
      },
      {
        label: 'Policies',
        path: '/policies',
        icon: SidebarIcons.PoliciesIcon,
        description: 'Routing policies & rules',
      },
    ],
  },
  {
    label: 'Monitor',
    items: [
      {
        label: 'Observability',
        path: '/observability',
        icon: SidebarIcons.ObservabilityIcon,
        description: 'Metrics & telemetry',
      },
    ],
  },
  {
    label: 'Resources',
    items: [
      {
        label: 'Providers',
        path: '/providers',
        icon: SidebarIcons.ProvidersIcon,
        description: 'AI provider catalog',
      },
      {
        // Free and paid are separate surfaces, not tabs of one page: they
        // answer different questions (what am I saving vs. what am I spending)
        // and are managed by different flows.
        label: 'Free Tier',
        path: '/free-tier',
        icon: SidebarIcons.FreeTierIcon,
        description: 'Free models, usage & savings',
      },
      {
        label: 'Models',
        path: '/models',
        icon: SidebarIcons.ModelsIcon,
        description: 'Paid model registry & spend',
      },
      {
        label: 'Tenants',
        path: '/tenants',
        icon: SidebarIcons.TenantsIcon,
        description: 'Tenants & API keys',
      },
    ],
  },
  {
    label: 'Agents',
    items: [
      {
        label: 'Agents',
        path: '/agents',
        icon: Bot,
        description: 'Build, deploy & run agents',
        matches: ['/agents'],
      },
      {
        label: 'Analytics',
        path: '/agents/analytics',
        icon: TrendingUp,
        description: 'Agent cost & performance',
      },
      {
        label: 'Marketplace',
        path: '/marketplace',
        icon: ShoppingBag,
        description: 'Community agent marketplace',
      },
      {
        label: 'Integrations',
        path: '/integrations',
        icon: Terminal,
        description: 'Claude Code, Codex & Antigravity',
      },
    ],
  },
  {
    label: 'Connectivity',
    items: [
      {
        label: 'MCP Servers',
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
    ],
  },
  {
    label: 'Billing',
    items: [
      {
        label: 'Billing',
        path: '/billing',
        icon: Wallet,
        description: 'Usage, credits & quotas',
      },
      {
        label: 'Cost Dashboard',
        path: '/cost',
        icon: SidebarIcons.UsageIcon,
        description: 'Real-time cost tracking',
      },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      {
        label: 'Infrastructure',
        path: '/infrastructure',
        icon: Cpu,
        description: 'Tools, workers & sandbox',
      },
    ],
  },
  {
    label: 'Settings',
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
