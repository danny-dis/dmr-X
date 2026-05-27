import { Routes, Route } from 'react-router-dom';
import Layout from '@/components/layout/Layout';
import Overview from './Overview';
import RoutingConsole from './RoutingConsole';
import ModelCatalog from './ModelCatalog';
import ProviderRegistry from './ProviderRegistry';
import QuotaManager from './QuotaManager';
import BillingCenter from './BillingCenter';
import MemoryCenter from './MemoryCenter';
import BenchmarkLab from './BenchmarkLab';
import Telemetry from './Telemetry';
import Federation from './Federation';
import Sandbox from './Sandbox';
import Scheduler from './Scheduler';
import PolicyEngine from './PolicyEngine';
import Tenants from './Tenants';
import AuditLogs from './AuditLogs';
import Alerts from './Alerts';
import ProviderKeys from './ProviderKeys';
import Settings from './Settings';
import Playground from './Playground';

export default function Home() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/routing" element={<RoutingConsole />} />
        <Route path="/models" element={<ModelCatalog />} />
        <Route path="/providers" element={<ProviderRegistry />} />
        <Route path="/quota" element={<QuotaManager />} />
        <Route path="/billing" element={<BillingCenter />} />
        <Route path="/memory" element={<MemoryCenter />} />
        <Route path="/benchmarks" element={<BenchmarkLab />} />
        <Route path="/telemetry" element={<Telemetry />} />
        <Route path="/federation" element={<Federation />} />
        <Route path="/sandbox" element={<Sandbox />} />
        <Route path="/scheduler" element={<Scheduler />} />
        <Route path="/policies" element={<PolicyEngine />} />
        <Route path="/tenants" element={<Tenants />} />
        <Route path="/audit" element={<AuditLogs />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/keys" element={<ProviderKeys />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/playground" element={<Playground />} />
      </Routes>
    </Layout>
  );
}
