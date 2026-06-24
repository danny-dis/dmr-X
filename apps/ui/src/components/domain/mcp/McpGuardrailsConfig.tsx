import { Shield, AlertTriangle, Filter, Plus, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Switch } from '@/components/primitives/Switch';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import type { ApiMcpGuardrailsConfig } from '@/types/api';

export function McpGuardrailsConfig() {
  const config = useApiData<ApiMcpGuardrailsConfig>(Admin.getGuardrailsConfig, []);
  const [saving, setSaving] = React.useState(false);

  const [enabled, setEnabled] = React.useState(true);
  const [piiEnabled, setPiiEnabled] = React.useState(true);
  const [maskChar, setMaskChar] = React.useState('*');
  const [contentFilterEnabled, setContentFilterEnabled] = React.useState(true);
  const [blockedPatterns, setBlockedPatterns] = React.useState<string[]>([]);
  const [newPattern, setNewPattern] = React.useState('');

  React.useEffect(() => {
    const d = config.data;
    if (!d) return;
    setEnabled(d.enabled);
    setPiiEnabled(d.pii?.enabled ?? true);
    setMaskChar(d.pii?.maskChar ?? '*');
    setContentFilterEnabled(d.contentFilter?.enabled ?? true);
    setBlockedPatterns(d.contentFilter?.blockedPatterns ?? []);
  }, [config.data]);

  const addPattern = () => {
    if (!newPattern.trim()) return;
    setBlockedPatterns((prev) => [...prev, newPattern.trim()]);
    setNewPattern('');
  };

  const removePattern = (idx: number) => {
    setBlockedPatterns((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Admin.updateGuardrailsConfig({
        enabled,
        pii: { enabled: piiEnabled, maskChar },
        contentFilter: { enabled: contentFilterEnabled, blockedPatterns },
      });
      toast.success('Guardrails config saved');
    } catch (err) {
      toast.error('Failed to save', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  if (config.isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
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
            <Shield className="size-4 text-primary" />
            Guardrails Engine
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Enable Guardrails</p>
              <p className="text-[10px] text-fg-muted">PII detection, content filtering, and redaction for tool inputs/outputs</p>
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
                <AlertTriangle className="size-3.5 text-primary" />
                PII Detection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">PII Detection</p>
                  <p className="text-[10px] text-fg-muted">Automatically detect SSN, credit cards, emails, phone numbers, IP addresses, AWS keys, GitHub tokens, and private keys</p>
                </div>
                <Switch checked={piiEnabled} onCheckedChange={setPiiEnabled} />
              </div>

              {piiEnabled && (
                <div className="space-y-2 pt-2">
                  <label className="text-[10px] font-medium text-fg-muted uppercase">Mask Character</label>
                  <Input
                    value={maskChar}
                    onChange={(e) => setMaskChar(e.target.value)}
                    placeholder="*"
                    className="w-24"
                  />
                  <p className="text-[10px] text-fg-subtle">Character used to mask detected PII (e.g., ***)</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs flex items-center gap-2">
                <Filter className="size-3.5 text-primary" />
                Content Filtering
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Content Filter</p>
                  <p className="text-[10px] text-fg-muted">Block tool calls matching regex patterns</p>
                </div>
                <Switch checked={contentFilterEnabled} onCheckedChange={setContentFilterEnabled} />
              </div>

              {contentFilterEnabled && (
                <div className="space-y-3 pt-2">
                  <div className="flex gap-2">
                    <Input
                      value={newPattern}
                      onChange={(e) => setNewPattern(e.target.value)}
                      placeholder="Add regex pattern (e.g., rm\\s+-rf)"
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addPattern();
                        }
                      }}
                    />
                    <Button size="icon-sm" onClick={addPattern}>
                      <Plus className="size-3" />
                    </Button>
                  </div>

                  {blockedPatterns.length > 0 && (
                    <div className="space-y-1">
                      {blockedPatterns.map((p, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-surface-2 rounded text-xs">
                          <code className="font-mono text-[10px]">{p}</code>
                          <button
                            type="button"
                            onClick={() => removePattern(i)}
                            className="text-fg-subtle hover:text-danger transition-colors"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {blockedPatterns.length === 0 && (
                    <p className="text-[10px] text-fg-subtle italic">No blocked patterns configured</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} loading={saving} size="sm">
          Save Guardrails Config
        </Button>
      </div>
    </div>
  );
}
