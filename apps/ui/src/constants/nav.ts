import {
  Bot,
  Cpu,
  Layers,
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
  badge?: string;
  description?: string;
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
        path: '/playground',
        icon: SidebarIcons.PlaygroundIcon,
        description: 'Test models & routing',
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
        label: 'Models',
        path: '/models',
        icon: SidebarIcons.ModelsIcon,
        description: 'Model registry',
      },
      {
        label: 'Tenants',
        path: '/tenants',
        icon: SidebarIcons.TenantsIcon,
        description: 'Tenants & API keys',
      },
      {
        label: 'Free Tier',
        path: '/free-tier',
        icon: SidebarIcons.FreeTierIcon,
        description: 'Free provider budget & routing',
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
        description: 'Agent definitions & instances',
      },
      {
        label: 'Integrations',
        path: '/integrations',
        icon: Terminal,
        description: 'Claude Code, Codex & Antigravity',
      },
      {
        label: 'Marketplace',
        path: '/marketplace',
        icon: ShoppingBag,
        description: 'Community agent marketplace',
      },
      {
        label: 'Analytics',
        path: '/agent-analytics',
        icon: TrendingUp,
        description: 'Agent performance metrics',
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
        description: 'MCP, tools, workers & sandbox',
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

export function findNavItem(path: string): NavItem | undefined {
  for (const g of NAV_GROUPS) {
    const found = g.items.find((i) => i.path === path);
    if (found) return found;
  }
  return undefined;
}

export function findGroup(path: string): NavGroup | undefined {
  for (const g of NAV_GROUPS) {
    if (g.items.some((i) => i.path === path)) return g;
  }
  return undefined;
}
