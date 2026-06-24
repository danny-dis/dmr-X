import { FileText, Database, Clock, AlertTriangle } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Switch } from '@/components/primitives/Switch';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import type { ApiMcpAuditConfig } from '@/types/api';

export function McpAuditConfig() {
  const config = useApiData<ApiMcpAuditConfig>(Admin.getAuditConfig, []);
  const [saving, setSaving] = React.useState(false);

  const [enabled, setEnabled] = React.useState(true);
  const [backend, setBackend] = React.useState('memory');
  const [retentionDays, setRetentionDays] = React.useState(30);
  const [logBodies, setLogBodies] = React.useState(false);

  React.useEffect(() => {
    const d = config.data;
    if (!d) return;
    setEnabled(d.enabled);
    setBackend(d.backend ?? 'memory');
    setRetentionDays(d.retentionDays ?? 30);
    setLogBodies(d.logBodies ?? false);
  }, [config.data]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Admin.updateAuditConfig({
        enabled,
        backend,
        retentionDays,
        logBodies,
      });
      toast.success('Audit config saved');
    } catch (err) {
      toast.error('Failed to save', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  if (config.isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            Audit Trail
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Enable Audit Logging</p>
              <p className="text-[10px] text-fg-muted">Track all tool invocations, auth events, and policy decisions with tamper-evident chaining</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardContent>
      </Card>

      {enabled && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-xs flex items-center gap-2">
                <Database className="size-3.5 text-primary" />
                Storage Backend
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-fg-muted uppercase">Backend</label>
                <div className="grid grid-cols-3 gap-2">
                  {['memory', 'sqlite', 'file'].map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBackend(b)}
                      className={`p-3 text-xs rounded-lg border transition-colors ${
                        backend === b
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-surface-2 text-fg-muted hover:bg-surface-3'
                      }`}
                    >
                      <div className="font-medium capitalize">{b}</div>
                      <div className="text-[10px] mt-1 opacity-70">
                        {b === 'memory' && 'In-process RAM'}
                        {b === 'sqlite' && 'SQLite database'}
                        {b === 'file' && 'JSON lines file'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs flex items-center gap-2">
                <Clock className="size-3.5 text-primary" />
                Retention & Options
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-medium text-fg-muted uppercase">Retention Days</label>
                <Input
                  type="number"
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(parseInt(e.target.value) || 30)}
                  className="w-32"
                  min={1}
                />
                <p className="text-[10px] text-fg-subtle">Events older than this are pruned (0 = keep forever)</p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Log Request/Response Bodies</p>
                  <p className="text-[10px] text-fg-muted">Include full tool input/output in audit events (may contain sensitive data)</p>
                </div>
                <Switch checked={logBodies} onCheckedChange={setLogBodies} />
              </div>

              {logBodies && (
                <div className="flex items-start gap-2 p-2 bg-warning/10 border border-warning/20 rounded text-[10px] text-warning">
                  <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                  Warning: Bodies may contain PII, secrets, or other sensitive data. Ensure your retention and access policies comply with your data governance requirements.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} loading={saving} size="sm">
          Save Audit Config
        </Button>
      </div>
    </div>
  );
}


