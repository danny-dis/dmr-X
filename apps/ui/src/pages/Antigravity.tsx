import {
  Terminal,
  AlertTriangle,
  Check,
  ExternalLink,
  Save,
  Download,
  Wifi,
  WifiOff,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Code } from '@/components/primitives/Code';
import { CopyButton } from '@/components/primitives/CopyButton';
import { DataState } from '@/components/primitives/DataState';
import { interpretError } from '@/components/primitives/ErrorState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Switch } from '@/components/primitives/Switch';
import { toast } from '@/components/primitives/Toast';
import { PageHeader, PageContainer } from '@/components/layout';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { cn } from '@/lib/utils';
import type { ApiProvider } from '@/types/api';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface TestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
}

interface AntigravityLoadResult {
  providers: ApiProvider[];
  geminiCli: Record<string, unknown> | null;
}

async function loadAntigravityData(): Promise<AntigravityLoadResult> {
  const [providerList, config] = await Promise.all([
    Admin.listProviders(),
    Admin.getAgentIntegrationConfig(),
  ]);
  // Antigravity (agy) speaks Google's Cloud Code protocol, so its settings
  // are stored under the shared "gemini-cli" integration key.
  return { providers: providerList, geminiCli: config.geminiCli ?? null };
}

/* -------------------------------------------------------------------------- */
/*  Model Status Indicator                                                     */
/* -------------------------------------------------------------------------- */

function ModelStatus({
  modelId,
  configured,
}: {
  modelId: string;
  configured: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="text-xs font-mono text-fg flex-1">{modelId}</span>
      {configured ? (
        <Badge tone="success" size="sm">
          <Check className="size-2.5 mr-0.5" aria-hidden />
          configured
        </Badge>
      ) : (
        <Badge tone="muted" size="sm">available</Badge>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Page                                                                  */
/* -------------------------------------------------------------------------- */

export function AntigravityPage() {
  const query = useApiData<AntigravityLoadResult>(loadAntigravityData, []);

  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);

  const [isEnabled, setIsEnabled] = React.useState(false);
  const [preferredProviderId, setPreferredProviderId] = React.useState<string | null>(null);

  // Sync form state whenever the saved config (re)loads.
  React.useEffect(() => {
    if (query.data?.geminiCli) {
      const ag = query.data.geminiCli;
      setIsEnabled((ag.isEnabled as boolean) ?? false);
      setPreferredProviderId((ag.preferredProviderId as string) ?? null);
    }
  }, [query.data]);

  const providers = query.data?.providers ?? [];

  const hasGoogleProvider = React.useMemo(() => {
    return providers.some(
      (p) =>
        p.name.toLowerCase().includes('google') ||
        p.name.toLowerCase().includes('vertex') ||
        p.name.toLowerCase().includes('antigravity'),
    );
  }, [providers]);

  const configuredModels = React.useMemo(() => {
    const models: Record<string, boolean> = {};
    for (const provider of providers) {
      if (!provider.models) continue;
      for (const model of provider.models) {
        models[model.modelId ?? model.id] = true;
      }
    }
    return models;
  }, [providers]);

  const antigravityModels = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-3-flash',
    'claude-opus-4-6-thinking',
    'claude-sonnet-4-5',
    'gpt-oss-120b-medium',
  ];

  // Save config to backend
  const handleSave = async () => {
    setSaving(true);
    try {
      await Admin.updateAgentIntegrationConfig('gemini-cli', {
        isEnabled,
        preferredProviderId,
      });
      toast.success('Configuration saved', {
        description: 'Your Antigravity integration settings have been saved.',
      });
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setSaving(false);
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await Admin.testIntegration('gemini-cli');
      setTestResult(result);
      if (result.success) {
        toast.success('Connection successful', {
          description: `Gateway responded in ${result.latencyMs}ms`,
        });
      } else {
        toast.error('Connection failed', {
          description: result.error ?? 'The gateway rejected the test request.',
        });
      }
    } catch (err) {
      const e = interpretError(err);
      setTestResult({ success: false, latencyMs: 0, error: e.description });
      toast.error(e.title, { description: e.description });
    } finally {
      setTesting(false);
    }
  };

  // Download wrapper script
  const handleDownloadScript = () => {
    const gatewayUrl = window.location.origin;

    const script = `#!/bin/bash
# DMR-X Antigravity (agy) Wrapper
# Generated: ${new Date().toISOString().split('T')[0]}

set -e

# Configuration
DMRX_GATEWAY="${gatewayUrl}"
GOOGLE_GEMINI_BASE_URL="\${DMRX_GATEWAY}"

# Validate gateway connectivity
echo "Testing DMR-X gateway connectivity..."
if ! curl -s --fail "\${DMRX_GATEWAY}/health" > /dev/null 2>&1; then
  echo "ERROR: Cannot reach DMR-X gateway at \${DMRX_GATEWAY}"
  echo "Please ensure the gateway is running: bun run dev:gateway"
  exit 1
fi
echo "Gateway is reachable."

# Launch agy
exec agy "$@"
`;

    const blob = new Blob([script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agy-dmrx.sh';
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Script downloaded', {
      description: 'Run: chmod +x agy-dmrx.sh && ./agy-dmrx.sh',
    });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Antigravity Integration"
        description="Configure DMR-X as a backend for Google Antigravity CLI (agy)"
        icon={<Terminal className="size-5" />}
        actions={
          <>
            <a
              href="https://github.com/google-antigravity/antigravity-cli"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="ghost" size="sm">
                <ExternalLink className="size-3" aria-hidden />
                Docs
              </Button>
            </a>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTestConnection}
              loading={testing}
              leftIcon={testResult?.success ? <Wifi className="size-3" /> : testResult ? <WifiOff className="size-3" /> : undefined}
            >
              Test Connection
            </Button>
            <Button size="sm" onClick={handleSave} loading={saving}>
              <Save className="size-3" aria-hidden />
              Save
            </Button>
          </>
        }
      />

      <div className="mt-5">
        <DataState
          data={query.data}
          isLoading={query.isLoading}
          error={query.error}
          onRetry={query.refetch}
          loading={
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          }
        >
          {() => (
            <div className="space-y-4">
              {/* Enable/Disable Toggle */}
              <Card padding="md">
                <CardHeader className="px-0 pt-0">
                  <CardTitle>Integration Status</CardTitle>
                  <p className="text-[10px] text-fg-muted mt-0.5">
                    Enable or disable the Antigravity integration.
                  </p>
                </CardHeader>
                <CardContent className="px-0">
                  <div className="flex items-center gap-3">
                    <Switch id="antigravity-enabled" checked={isEnabled} onCheckedChange={setIsEnabled} />
                    <label htmlFor="antigravity-enabled" className="text-sm text-fg cursor-pointer">
                      {isEnabled ? 'Enabled' : 'Disabled'}
                    </label>
                  </div>
                </CardContent>
              </Card>

              {/* Test Result */}
              {testResult && (
                <div
                  className={cn(
                    'rounded-lg border px-4 py-3',
                    testResult.success
                      ? 'border-success/30 bg-success/5'
                      : 'border-danger/30 bg-danger/5',
                  )}
                >
                  <div className="flex items-start gap-2">
                    {testResult.success ? (
                      <Wifi className="size-4 text-success shrink-0 mt-0.5" aria-hidden />
                    ) : (
                      <WifiOff className="size-4 text-danger shrink-0 mt-0.5" aria-hidden />
                    )}
                    <div className="text-xs text-fg leading-relaxed">
                      <p className="font-medium">
                        {testResult.success ? 'Connection successful' : 'Connection failed'}
                      </p>
                      <p className="text-fg-muted">
                        {testResult.success
                          ? `Gateway responded in ${testResult.latencyMs}ms`
                          : testResult.error}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Setup Instructions */}
              <Card padding="md">
                <CardHeader className="px-0 pt-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Setup</CardTitle>
                      <p className="text-[10px] text-fg-muted mt-0.5">
                        Point agy at your DMR-X gateway to route requests through your configured providers.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleDownloadScript}
                      leftIcon={<Download className="size-3" />}
                    >
                      Download Script
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="px-0 space-y-3">
                  <div className="text-xs text-fg-muted">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-medium text-fg">1. Start the DMR-X gateway:</p>
                      <CopyButton value="bun run dev:gateway" label="Copy command" />
                    </div>
                    <Code inline={false}>bun run dev:gateway</Code>
                  </div>

                  <div className="text-xs text-fg-muted">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-medium text-fg">2. Set environment variables and run agy:</p>
                      <CopyButton
                        value={`export GOOGLE_GEMINI_BASE_URL="${window.location.origin}"\n\nagy "Explain this codebase"`}
                        label="Copy commands"
                      />
                    </div>
                    <Code inline={false} className="whitespace-pre-wrap">{`# Point agy at DMR-X
export GOOGLE_GEMINI_BASE_URL="${window.location.origin}"

# Run agy as usual (uses Google OAuth)
agy "Explain this codebase"`}</Code>
                  </div>

                  <div className="text-xs text-fg-muted">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-medium text-fg">3. Alternatively, configure via the agy config file:</p>
                      <CopyButton
                        value={`GOOGLE_GEMINI_BASE_URL=${window.location.origin}`}
                        label="Copy config line"
                      />
                    </div>
                    <Code inline={false} className="whitespace-pre-wrap">{`# ~/.antigravity/settings.json or ~/.gemini/.env
GOOGLE_GEMINI_BASE_URL=${window.location.origin}`}</Code>
                  </div>
                </CardContent>
              </Card>

              {/* Available Models */}
              <Card padding="md">
                <CardHeader className="px-0 pt-0">
                  <CardTitle>Available Models</CardTitle>
                  <p className="text-[10px] text-fg-muted mt-0.5">
                    Models accessible through DMR-X when agy connects.
                  </p>
                </CardHeader>
                <CardContent className="px-0">
                  <div className="divide-y divide-border">
                    {antigravityModels.map((modelId) => (
                      <ModelStatus
                        key={modelId}
                        modelId={modelId}
                        configured={configuredModels[modelId] ?? false}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* How it works */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 text-primary shrink-0 mt-0.5" aria-hidden />
                  <div className="text-xs text-fg leading-relaxed">
                    <p className="font-medium mb-1">How it works</p>
                    <p className="text-fg-muted">
                      Antigravity (agy) uses Google's Cloud Code protocol, which is different from
                      OpenAI or Anthropic formats. DMR-X acts as a protocol translator — it accepts
                      Cloud Code requests from agy, converts them to DMR-X's internal format, routes
                      through your configured providers, and translates the responses back.
                    </p>
                    <p className="text-fg-muted mt-2">
                      <strong>Note:</strong> agy authenticates with Google OAuth. DMR-X uses its own
                      stored provider keys for routing — the OAuth token is accepted but not required.
                      Configure your providers (OpenAI, Anthropic, Google) in the DMR-X admin UI.
                    </p>
                  </div>
                </div>
              </div>

              {/* Provider Status */}
              {!hasGoogleProvider && (
                <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" aria-hidden />
                    <div className="text-xs text-fg leading-relaxed">
                      <p className="font-medium mb-1">No Google provider configured</p>
                      <p className="text-fg-muted">
                        For best results with agy, configure a Google/Vertex AI provider in the
                        DMR-X admin UI. This enables routing to Gemini models natively.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DataState>
      </div>
    </PageContainer>
  );
}
