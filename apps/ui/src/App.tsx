import { HashRouter, Routes, Route } from 'react-router';
import { Shell } from '@/components/layout';
import {
  DashboardPage,
  PlaygroundPage,
  RequestsPage,
  RoutingPage,
  QuotaPage,
  ProvidersPage,
  ModelsPage,
  TenantsPage,
  PoliciesPage,
  UsagePage,
  BenchmarksPage,
  MemoryPage,
  SandboxPage,
  WorkersPage,
  FederationPage,
  ObservabilityPage,
  SettingsPage,
  ConnectPage,
  NotFoundPage,
} from '@/pages';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/routing" element={<RoutingPage />} />
          <Route path="/quota" element={<QuotaPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/tenants" element={<TenantsPage />} />
          <Route path="/policies" element={<PoliciesPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/benchmarks" element={<BenchmarksPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/sandbox" element={<SandboxPage />} />
          <Route path="/workers" element={<WorkersPage />} />
          <Route path="/federation" element={<FederationPage />} />
          <Route path="/observability" element={<ObservabilityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/connect" element={<ConnectPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
