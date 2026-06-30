import {
  LayoutDashboard,
  FlaskConical,
  Workflow,
  Activity,
  Gauge as GaugeIcon,
  Boxes,
  Database,
  Users,
  Shield,
  Wallet,
  Trophy,
  MemoryStick,
  Terminal,
  Hammer,
  Cpu,
  Network,
  Bell,
  Settings,
  Plug,
  Minimize2,
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
      {
        label: 'Free Tier',
        path: '/free-tier',
        icon: SidebarIcons.FreeTierIcon,
        description: 'Free providers & bonuses',
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
        label: 'Quota',
        path: '/quota',
        icon: GaugeIcon,
        description: 'Tenant usage limits',
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
    label: 'Governance',
    items: [
      {
        label: 'Policies',
        path: '/policies',
        icon: Shield,
        description: 'Routing & access rules',
      },
      {
        label: 'Usage & Cost',
        path: '/usage',
        icon: Wallet,
        description: 'Billing & budgets',
      },
      {
        label: 'Benchmarks',
        path: '/benchmarks',
        icon: Trophy,
        description: 'Performance comparisons',
      },
      {
        label: 'Memory',
        path: '/memory',
        icon: MemoryStick,
        description: 'Tenant memory store',
      },
    ],
  },
  {
    label: 'Platform',
    items: [
      {
        label: 'Sandbox',
        path: '/sandbox',
        icon: Terminal,
        description: 'Ephemeral execution',
      },
      {
        label: 'MCP Server',
        path: '/mcp',
        icon: Cpu,
        description: 'Model Context Protocol server',
      },
      {
        label: 'Tools',
        path: '/tools',
        icon: Hammer,
        description: 'Test tool execution & loops',
      },
      {
        label: 'Workers',
        path: '/workers',
        icon: Cpu,
        description: 'Background job workers',
      },
      {
        label: 'Federation',
        path: '/federation',
        icon: Network,
        description: 'Peer gateway nodes',
      },
    ],
  },
  {
    label: 'Observability',
    items: [
      {
        label: 'Observability',
        path: '/observability',
        icon: Bell,
        description: 'Alerts · Audit · Telemetry',
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        label: 'Claude Code',
        path: '/claude-code',
        icon: Terminal,
        description: 'Claude Code integration',
      },
      {
        label: 'Settings',
        path: '/settings',
        icon: Settings,
        description: 'Gateway configuration',
      },
      {
        label: 'Compression',
        path: '/compression',
        icon: Minimize2,
        description: 'Headroom token compression',
      },
      {
        label: 'Connect',
        path: '/connect',
        icon: Plug,
        description: 'API reference & examples',
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
