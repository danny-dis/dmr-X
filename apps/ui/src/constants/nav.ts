import {
  FlaskConical,
  Workflow,
  Activity,
  Boxes,
  Database,
  Users,
  Wallet,
  Cpu,
  Settings,
  Layers,
  type LucideIcon,
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
        icon: FlaskConical,
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
        icon: Workflow,
        description: 'Live request stream',
      },
      {
        label: 'Routing',
        path: '/routing',
        icon: Activity,
        description: 'Decisions & strategies',
      },
      {
        label: 'Fusion Panel',
        path: '/fusion',
        icon: Layers,
        description: 'Multi-model diversity',
      },
    ],
  },
  {
    label: 'Resources',
    items: [
      {
        label: 'Providers',
        path: '/providers',
        icon: Boxes,
        description: 'AI provider catalog',
      },
      {
        label: 'Models',
        path: '/models',
        icon: Database,
        description: 'Model registry',
      },
      {
        label: 'Tenants',
        path: '/tenants',
        icon: Users,
        description: 'Tenants & API keys',
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
        description: 'Costs, credits & quotas',
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
        description: 'MCP, tools & workers',
      },
    ],
  },
  {
    label: 'Settings',
    items: [
      {
        label: 'Settings',
        path: '/settings',
        icon: Settings,
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
