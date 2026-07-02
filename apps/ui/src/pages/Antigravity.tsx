import {
  Terminal,
  AlertTriangle,
  Check,
  ExternalLink,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { toast } from '@/components/primitives/Toast';
import { PageHeader, PageContainer } from '@/components/layout';
import { Admin } from '@/lib/admin';
import { cn } from '@/lib/utils';
import type { ApiProvider } from '@/types/api';

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
          <Check className="size-2.5 mr-0.5" />
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
  const [providers, setProviders] = React.useState<ApiProvider[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    Admin.listProviders()
      .then(setProviders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) {
    return (
      <PageContainer>
        <PageHeader
          title="Antigravity Integration"
          description="Configure DMR-X as a backend for Google Antigravity CLI (agy)"
          icon={<Terminal className="size-5" />}
        />
        <div className="mt-5 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-surface-2 animate-pulse" />
          ))}
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Antigravity Integration"
        description="Configure DMR-X as a backend for Google Antigravity CLI (agy)"
        icon={<Terminal className="size-5" />}
        actions={
          <a
            href="https://github.com/google-antigravity/antigravity-cli"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="ghost" size="sm">
              <ExternalLink className="size-3" />
              Docs
            </Button>
          </a>
        }
      />

      <div className="mt-5 space-y-4">
        {/* Setup Instructions */}
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Setup</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">
              Point agy at your DMR-X gateway to route requests through your configured providers.
            </p>
          </CardHeader>
          <CardContent className="px-0 space-y-3">
            <div className="text-xs text-fg-muted">
              <p className="mb-2 font-medium text-fg">1. Start the DMR-X gateway:</p>
              <pre className="px-3 py-2 bg-surface-2 rounded-lg border border-border font-mono text-[11px]">
                bun run dev:gateway
              </pre>
            </div>

            <div className="text-xs text-fg-muted">
              <p className="mb-2 font-medium text-fg">2. Set environment variables and run agy:</p>
              <pre className="px-3 py-2 bg-surface-2 rounded-lg border border-border font-mono text-[11px] whitespace-pre-wrap">{`# Point agy at DMR-X
export GOOGLE_GEMINI_BASE_URL=http://localhost:3000

# Run agy as usual (uses Google OAuth)
agy "Explain this codebase"`}</pre>
            </div>

            <div className="text-xs text-fg-muted">
              <p className="mb-2 font-medium text-fg">3. Alternatively, configure via the agy config file:</p>
              <pre className="px-3 py-2 bg-surface-2 rounded-lg border border-border font-mono text-[11px] whitespace-pre-wrap">{`# ~/.antigravity/settings.json or ~/.gemini/.env
GOOGLE_GEMINI_BASE_URL=http://localhost:3000`}</pre>
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
            <AlertTriangle className="size-4 text-primary shrink-0 mt-0.5" />
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
              <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
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
    </PageContainer>
  );
}
