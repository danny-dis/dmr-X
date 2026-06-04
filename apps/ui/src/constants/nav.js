import * as SidebarIcons from '@/icons/SidebarIcons';
import { FlaskConical, Workflow, Activity, Gauge as GaugeIcon, Boxes, Database, Users, Shield, Wallet, Trophy, MemoryStick, Terminal, Cpu, Network, Bell, Settings, Plug, } from 'lucide-react';
export const NAV_GROUPS = [
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
                label: 'Settings',
                path: '/settings',
                icon: Settings,
                description: 'Gateway configuration',
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
export function findNavItem(path) {
    for (const g of NAV_GROUPS) {
        const found = g.items.find((i) => i.path === path);
        if (found)
            return found;
    }
    return undefined;
}
export function findGroup(path) {
    for (const g of NAV_GROUPS) {
        if (g.items.some((i) => i.path === path))
            return g;
    }
    return undefined;
}
//# sourceMappingURL=nav.js.map