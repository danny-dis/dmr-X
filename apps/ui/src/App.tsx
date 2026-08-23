import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';

import { Shell } from '@/components/layout';
import { ErrorBoundary } from '@/components/primitives/ErrorBoundary';
import { Skeleton } from '@/components/primitives/Skeleton';
import { queryClient } from '@/lib/queryClient';

// Lazy-load all page components for code splitting
const DashboardPage = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.DashboardPage })));
const PlaygroundPage = lazy(() => import('@/pages/Playground').then(m => ({ default: m.PlaygroundPage })));
const RequestsPage = lazy(() => import('@/pages/Requests').then(m => ({ default: m.RequestsPage })));
const RoutingPage = lazy(() => import('@/pages/Routing').then(m => ({ default: m.RoutingPage })));
const ProvidersPage = lazy(() => import('@/pages/Providers').then(m => ({ default: m.ProvidersPage })));
const ModelsPage = lazy(() => import('@/pages/Models').then(m => ({ default: m.ModelsPage })));
const TenantsPage = lazy(() => import('@/pages/Tenants').then(m => ({ default: m.TenantsPage })));
const PoliciesPage = lazy(() => import('@/pages/Policies').then(m => ({ default: m.PoliciesPage })));
const FusionPanelPage = lazy(() => import('@/pages/FusionPanel').then(m => ({ default: m.FusionPanelPage })));
const BillingPage = lazy(() => import('@/pages/Billing').then(m => ({ default: m.BillingPage })));
const InfrastructurePage = lazy(() => import('@/pages/Infrastructure').then(m => ({ default: m.InfrastructurePage })));
const SettingsTabsPage = lazy(() => import('@/pages/SettingsTabs').then(m => ({ default: m.SettingsTabsPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFound').then(m => ({ default: m.NotFoundPage })));

// Agent platform
const AgentsPage = lazy(() => import('@/pages/agents/AgentsPage').then(m => ({ default: m.AgentsPage })));
const AgentDetailPage = lazy(() => import('@/pages/agents/AgentDetailPage').then(m => ({ default: m.AgentDetailPage })));
const AgentCreatePage = lazy(() => import('@/pages/agents/AgentCreatePage').then(m => ({ default: m.AgentCreatePage })));
const AgentAnalyticsPage = lazy(() => import('@/pages/agents/AgentAnalyticsPage').then(m => ({ default: m.AgentAnalyticsPage })));
const JobsPage = lazy(() => import('@/pages/agents/JobsPage').then(m => ({ default: m.JobsPage })));
const MarketplacePage = lazy(() => import('@/pages/Marketplace').then(m => ({ default: m.MarketplacePage })));

// MCP + A2A
const McpPage = lazy(() => import('@/pages/mcp/McpPage').then(m => ({ default: m.McpPage })));
const McpDiscoverPage = lazy(() => import('@/pages/mcp/McpDiscoverPage').then(m => ({ default: m.McpDiscoverPage })));
const McpToolsPage = lazy(() => import('@/pages/mcp/McpToolsPage').then(m => ({ default: m.McpToolsPage })));
const McpSettingsPage = lazy(() => import('@/pages/mcp/McpSettingsPage').then(m => ({ default: m.McpSettingsPage })));
const A2APage = lazy(() => import('@/pages/A2A').then(m => ({ default: m.A2APage })));

// Free tier
const FreeTierPage = lazy(() => import('@/pages/free-tier/FreeTierPage').then(m => ({ default: m.FreeTierPage })));

// Sub-pages lazy-loaded by tabbed containers (hidden routes for code splitting)
const UsagePage = lazy(() => import('@/pages/Usage').then(m => ({ default: m.UsagePage })));
const CreditsPage = lazy(() => import('@/pages/Credits').then(m => ({ default: m.CreditsPage })));
const QuotaPage = lazy(() => import('@/pages/Quota').then(m => ({ default: m.QuotaPage })));
const BenchmarksPage = lazy(() => import('@/pages/Benchmarks').then(m => ({ default: m.BenchmarksPage })));
const MemoryPage = lazy(() => import('@/pages/Memory').then(m => ({ default: m.MemoryPage })));
const ToolsPage = lazy(() => import('@/pages/Tools').then(m => ({ default: m.ToolsPage })));
const WorkersPage = lazy(() => import('@/pages/Workers').then(m => ({ default: m.WorkersPage })));
const FederationPage = lazy(() => import('@/pages/Federation').then(m => ({ default: m.FederationPage })));
const SandboxPage = lazy(() => import('@/pages/Sandbox').then(m => ({ default: m.SandboxPage })));
const CompressionPage = lazy(() => import('@/pages/Compression').then(m => ({ default: m.CompressionPage })));
const ConnectPage = lazy(() => import('@/pages/Connect').then(m => ({ default: m.ConnectPage })));
const AgentIntegrationsPage = lazy(() => import('@/pages/AgentIntegrations').then(m => ({ default: m.AgentIntegrationsPage })));
const CostDashboardPage = lazy(() => import('@/pages/CostDashboard').then(m => ({ default: m.CostDashboardPage })));
const ObservabilityPage = lazy(() => import('@/pages/Observability').then(m => ({ default: m.ObservabilityPage })));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <Skeleton className="h-8 w-48" />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/*
        BrowserRouter, not HashRouter: real paths make routes linkable and
        bookmarkable, and the gateway already serves an SPA fallback for
        non-API GETs (server.ts), so a deep link resolves on refresh.
      */}
      <BrowserRouter>
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route element={<Shell />}>
                {/* Overview */}
                <Route index element={<DashboardPage />} />
                {/*
                  Playground mode lives in the path so a conversation in agent
                  or godmode can be linked to. Bare /playground redirects to
                  chat rather than 404ing.
                */}
                <Route path="/playground" element={<Navigate to="/playground/chat" replace />} />
                <Route path="/playground/:mode" element={<PlaygroundPage />} />

                {/* Traffic */}
                <Route path="/requests" element={<RequestsPage />} />
                <Route path="/routing" element={<RoutingPage />} />
                <Route path="/policies" element={<PoliciesPage />} />
                <Route path="/fusion" element={<FusionPanelPage />} />

                {/* Monitor */}
                <Route path="/observability" element={<ObservabilityPage />} />

                {/* Resources — Free Tier and Models are siblings, not tabs */}
                <Route path="/providers" element={<ProvidersPage />} />
                <Route path="/models" element={<ModelsPage />} />
                <Route path="/free-tier" element={<FreeTierPage />} />
                <Route path="/tenants" element={<TenantsPage />} />

                {/* Agents */}
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/agents/new" element={<AgentCreatePage />} />
                <Route path="/agents/analytics" element={<AgentAnalyticsPage />} />
                <Route path="/jobs" element={<JobsPage />} />
                <Route path="/agents/:id" element={<AgentDetailPage />} />
                <Route path="/marketplace" element={<MarketplacePage />} />
                <Route path="/integrations" element={<AgentIntegrationsPage />} />

                {/* MCP + A2A */}
                <Route path="/mcp" element={<McpPage />} />
                <Route path="/mcp/discover" element={<McpDiscoverPage />} />
                <Route path="/mcp/tools" element={<McpToolsPage />} />
                <Route path="/mcp/settings" element={<McpSettingsPage />} />
                <Route path="/a2a" element={<A2APage />} />

                {/* Billing */}
                <Route path="/billing" element={<BillingPage />} />
                <Route path="/cost" element={<CostDashboardPage />} />
                <Route path="/usage" element={<UsagePage />} />
                <Route path="/credits" element={<CreditsPage />} />
                <Route path="/quota" element={<QuotaPage />} />

                {/* Infrastructure */}
                <Route path="/infrastructure" element={<InfrastructurePage />} />
                <Route path="/workers" element={<WorkersPage />} />
                <Route path="/federation" element={<FederationPage />} />
                <Route path="/sandbox" element={<SandboxPage />} />
                <Route path="/memory" element={<MemoryPage />} />
                <Route path="/tools" element={<ToolsPage />} />
                <Route path="/benchmarks" element={<BenchmarksPage />} />
                <Route path="/compression" element={<CompressionPage />} />
                <Route path="/connect" element={<ConnectPage />} />

                {/* Settings */}
                <Route path="/settings" element={<SettingsTabsPage />} />

                {/*
                  The old free-tier dashboard was an orphan route nothing linked
                  to; its content now lives on the Free Tier page.
                */}
                <Route path="/free-tier/dashboard" element={<Navigate to="/free-tier" replace />} />

                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
