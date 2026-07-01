import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router';

import { Shell } from '@/components/layout';
import { ErrorBoundary } from '@/components/primitives/ErrorBoundary';
import { Skeleton } from '@/components/primitives/Skeleton';

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

// Sub-pages lazy-loaded by tabbed containers (hidden routes for code splitting)
const UsagePage = lazy(() => import('@/pages/Usage').then(m => ({ default: m.UsagePage })));
const CreditsPage = lazy(() => import('@/pages/Credits').then(m => ({ default: m.CreditsPage })));
const QuotaPage = lazy(() => import('@/pages/Quota').then(m => ({ default: m.QuotaPage })));
const BenchmarksPage = lazy(() => import('@/pages/Benchmarks').then(m => ({ default: m.BenchmarksPage })));
const MemoryPage = lazy(() => import('@/pages/Memory').then(m => ({ default: m.MemoryPage })));
const MCPPage = lazy(() => import('@/pages/MCP').then(m => ({ default: m.MCPPage })));
const ToolsPage = lazy(() => import('@/pages/Tools').then(m => ({ default: m.ToolsPage })));
const WorkersPage = lazy(() => import('@/pages/Workers').then(m => ({ default: m.WorkersPage })));
const FederationPage = lazy(() => import('@/pages/Federation').then(m => ({ default: m.FederationPage })));
const SandboxPage = lazy(() => import('@/pages/Sandbox').then(m => ({ default: m.SandboxPage })));
const SettingsPage = lazy(() => import('@/pages/Settings').then(m => ({ default: m.SettingsPage })));
const CompressionPage = lazy(() => import('@/pages/Compression').then(m => ({ default: m.CompressionPage })));
const ConnectPage = lazy(() => import('@/pages/Connect').then(m => ({ default: m.ConnectPage })));
const ClaudeCodePage = lazy(() => import('@/pages/ClaudeCode').then(m => ({ default: m.ClaudeCodePage })));
const FreeTierPage = lazy(() => import('@/pages/FreeTier').then(m => ({ default: m.FreeTierPage })));
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
    <HashRouter>
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route element={<Shell />}>
              {/* Primary routes — visible in sidebar */}
              <Route index element={<DashboardPage />} />
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/routing" element={<RoutingPage />} />
              <Route path="/policies" element={<PoliciesPage />} />
              <Route path="/fusion" element={<FusionPanelPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="/models" element={<ModelsPage />} />
              <Route path="/tenants" element={<TenantsPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/infrastructure" element={<InfrastructurePage />} />
              <Route path="/settings" element={<SettingsTabsPage />} />

              {/* Sub-pages (hidden routes — lazy-imported by tabbed containers) */}
              <Route path="/usage" element={<UsagePage />} />
              <Route path="/credits" element={<CreditsPage />} />
              <Route path="/quota" element={<QuotaPage />} />
              <Route path="/benchmarks" element={<BenchmarksPage />} />
              <Route path="/memory" element={<MemoryPage />} />
              <Route path="/mcp" element={<MCPPage />} />
              <Route path="/tools" element={<ToolsPage />} />
              <Route path="/workers" element={<WorkersPage />} />
              <Route path="/federation" element={<FederationPage />} />
              <Route path="/sandbox" element={<SandboxPage />} />
              <Route path="/compression" element={<CompressionPage />} />
              <Route path="/connect" element={<ConnectPage />} />
              <Route path="/claude-code" element={<ClaudeCodePage />} />
              <Route path="/free-tier" element={<FreeTierPage />} />
              <Route path="/observability" element={<ObservabilityPage />} />

              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </HashRouter>
  );
}
