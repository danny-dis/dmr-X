import { Search, Settings, Zap } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Slider } from '@/components/primitives/Slider';
import { Switch } from '@/components/primitives/Switch';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import type { ApiMcpToolSearchConfig } from '@/types/api';

export function McpToolSearchConfig() {
  const config = useApiData<ApiMcpToolSearchConfig>(Admin.getToolSearchConfig, []);
  const [saving, setSaving] = React.useState(false);

  const [enabled, setEnabled] = React.useState(true);
  const [bm25Enabled, setBm25Enabled] = React.useState(true);
  const [bm25K1, setBm25K1] = React.useState(1.5);
  const [bm25B, setBm25B] = React.useState(0.75);
  const [semanticEnabled, setSemanticEnabled] = React.useState(true);
  const [semanticUrl, setSemanticUrl] = React.useState('');
  const [hybridEnabled, setHybridEnabled] = React.useState(true);
  const [rrfConstant, setRrfConstant] = React.useState(60);

  // Sync form state when data loads
  React.useEffect(() => {
    const d = config.data;
    if (!d) return;
    setEnabled(d.enabled);
    setBm25Enabled(d.bm25?.enabled ?? true);
    setBm25K1(d.bm25?.k1 ?? 1.5);
    setBm25B(d.bm25?.b ?? 0.75);
    setSemanticEnabled(d.semantic?.enabled ?? true);
    setSemanticUrl(d.semantic?.remoteUrl ?? '');
    setHybridEnabled(d.hybrid?.enabled ?? true);
    setRrfConstant(d.hybrid?.rrfConstant ?? 60);
  }, [config.data]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Admin.updateToolSearchConfig({
        enabled,
        bm25: { enabled: bm25Enabled, k1: bm25K1, b: bm25B },
        semantic: { enabled: semanticEnabled, remoteUrl: semanticUrl },
        hybrid: { enabled: hybridEnabled, rrfConstant },
      });
      toast.success('Tool search config saved');
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
            <Settings className="size-4 text-primary" />
            Tool Search Engine
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Enable Tool Search</p>
              <p className="text-[10px] text-fg-muted">Allow natural language search for available tools</p>
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
                <Search className="size-3.5 text-primary" />
                BM25 Keyword Search
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">BM25 Search</p>
                  <p className="text-[10px] text-fg-muted">Classic keyword-based relevance scoring</p>
                </div>
                <Switch checked={bm25Enabled} onCheckedChange={setBm25Enabled} />
              </div>

              {bm25Enabled && (
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-2">
                    <label className="text-[10px] font-medium text-fg-muted uppercase">K1 ({bm25K1.toFixed(1)})</label>
                    <Slider
                      value={[bm25K1]}
                      onValueChange={(v) => setBm25K1(v[0])}
                      min={0.5}
                      max={3.0}
                      step={0.1}
                    />
                    <p className="text-[10px] text-fg-subtle">Term frequency saturation</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-medium text-fg-muted uppercase">B ({bm25B.toFixed(2)})</label>
                    <Slider
                      value={[bm25B]}
                      onValueChange={(v) => setBm25B(v[0])}
                      min={0.0}
                      max={1.0}
                      step={0.05}
                    />
                    <p className="text-[10px] text-fg-subtle">Document length normalization</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs flex items-center gap-2">
                <Zap className="size-3.5 text-primary" />
                Semantic Search
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Semantic Search</p>
                  <p className="text-[10px] text-fg-muted">Embedding-based similarity search</p>
                </div>
                <Switch checked={semanticEnabled} onCheckedChange={setSemanticEnabled} />
              </div>

              {semanticEnabled && (
                <div className="space-y-2 pt-2">
                  <label className="text-[10px] font-medium text-fg-muted uppercase">Remote Embedding URL</label>
                  <Input
                    value={semanticUrl}
                    onChange={(e) => setSemanticUrl(e.target.value)}
                    placeholder="http://localhost:8080/embed"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs flex items-center gap-2">
                <Search className="size-3.5 text-primary" />
                Hybrid Fusion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Hybrid Search</p>
                  <p className="text-[10px] text-fg-muted">Combine BM25 + semantic via Reciprocal Rank Fusion</p>
                </div>
                <Switch checked={hybridEnabled} onCheckedChange={setHybridEnabled} />
              </div>

              {hybridEnabled && (
                <div className="space-y-2 pt-2">
                  <label className="text-[10px] font-medium text-fg-muted uppercase">RRF Constant (k={rrfConstant})</label>
                  <Slider
                    value={[rrfConstant]}
                    onValueChange={(v) => setRrfConstant(v[0])}
                    min={10}
                    max={200}
                    step={5}
                  />
                  <p className="text-[10px] text-fg-subtle">Higher values give more weight to lower-ranked results</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} loading={saving} size="sm">
          Save Tool Search Config
        </Button>
      </div>
    </div>
  );
}
