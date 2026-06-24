import { Network, Plus, Trash2, Globe, Server } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/primitives/Dialog';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Switch } from '@/components/primitives/Switch';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import type { ApiMcpFederationConfig, ApiMcpFederationPeer } from '@/types/api';

export function McpFederationConfig() {
  const config = useApiData<{ enabled: boolean; discovery: { mdns: boolean; dns: { domain: string } }; syncInterval: string }>(
    Admin.getFederationConfig, []
  );
  const peersData = useApiData<{ peers: ApiMcpFederationPeer[] }>(Admin.listFederationPeers, []);
  const [saving, setSaving] = React.useState(false);
  const [enabled, setEnabled] = React.useState(true);
  const [mdnsEnabled, setMdnsEnabled] = React.useState(true);
  const [dnsDomain, setDnsDomain] = React.useState('');
  const [syncInterval, setSyncInterval] = React.useState('60s');
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // Add peer form
  const [peerName, setPeerName] = React.useState('');
  const [peerEndpoint, setPeerEndpoint] = React.useState('');
  const [peerSecret, setPeerSecret] = React.useState('');

  const peers = peersData.data?.peers ?? [];

  React.useEffect(() => {
    const d = config.data;
    if (!d) return;
    setEnabled(d.enabled);
    setMdnsEnabled(d.discovery?.mdns ?? true);
    setDnsDomain(d.discovery?.dns?.domain ?? '');
    setSyncInterval(d.syncInterval ?? '60s');
  }, [config.data]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Admin.updateFederationConfig({
        enabled,
        discovery: { mdns: mdnsEnabled, dns: { domain: dnsDomain } },
        syncInterval,
      });
      toast.success('Federation config saved');
    } catch (err) {
      toast.error('Failed to save', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleAddPeer = async () => {
    if (!peerName.trim() || !peerEndpoint.trim()) {
      toast.error('Name and endpoint are required');
      return;
    }
    setSaving(true);
    try {
      await Admin.addFederationPeer({
        name: peerName,
        endpoint: peerEndpoint,
        secretRef: peerSecret || undefined,
      });
      toast.success('Peer added');
      setDialogOpen(false);
      setPeerName('');
      setPeerEndpoint('');
      setPeerSecret('');
      await peersData.refetch();
    } catch (err) {
      toast.error('Failed to add peer', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePeer = async (id: string) => {
    try {
      await Admin.removeFederationPeer(id);
      toast.success('Peer removed');
      await peersData.refetch();
    } catch (err) {
      toast.error('Failed to remove peer', { description: err instanceof Error ? err.message : String(err) });
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
            <Network className="size-4 text-primary" />
            Federation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Enable Federation</p>
              <p className="text-[10px] text-fg-muted">Share tools across DMR-X instances via peer-to-peer sync</p>
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
                <Globe className="size-3.5 text-primary" />
                Discovery
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">mDNS Discovery</p>
                  <p className="text-[10px] text-fg-muted">Automatically discover peers on the local network</p>
                </div>
                <Switch checked={mdnsEnabled} onCheckedChange={setMdnsEnabled} />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-medium text-fg-muted uppercase">DNS Discovery Domain</label>
                <Input
                  value={dnsDomain}
                  onChange={(e) => setDnsDomain(e.target.value)}
                  placeholder="e.g., dmrx.internal"
                />
                <p className="text-[10px] text-fg-subtle">SRV record domain for DNS-based peer discovery</p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-medium text-fg-muted uppercase">Sync Interval</label>
                <Input
                  value={syncInterval}
                  onChange={(e) => setSyncInterval(e.target.value)}
                  placeholder="60s"
                  className="w-32"
                />
                <p className="text-[10px] text-fg-subtle">How often to sync tool catalogs with peers</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs flex items-center gap-2">
                <Server className="size-3.5 text-primary" />
                Peers
                <Badge tone="muted" size="sm" className="ml-auto">{peers.length}</Badge>
                <Button size="icon-sm" onClick={() => setDialogOpen(true)}>
                  <Plus className="size-3" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {peers.length === 0 ? (
                <div className="text-center py-6">
                  <Network className="size-8 text-fg-subtle mx-auto mb-2" />
                  <p className="text-xs text-fg-muted">No federation peers configured</p>
                  <p className="text-[10px] text-fg-subtle mt-1">Add peers to share tools across instances</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {peers.map((peer) => (
                    <div
                      key={peer.id}
                      className="flex items-center gap-3 p-3 bg-surface-2 rounded-lg"
                    >
                      <Server className="size-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold">{peer.name}</span>
                          <StatusPill
                            status={peer.status === 'healthy' ? 'online' : peer.status === 'error' ? 'offline' : 'unknown'}
                            label={peer.status ?? 'unknown'}
                          />
                        </div>
                        <p className="text-[10px] font-mono text-fg-muted truncate">{peer.endpoint}</p>
                        {peer.lastSync && (
                          <p className="text-[10px] text-fg-subtle">Last sync: {new Date(peer.lastSync).toLocaleString()}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePeer(peer.id)}
                        className="text-fg-subtle hover:text-danger transition-colors shrink-0"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} loading={saving} size="sm">
          Save Federation Config
        </Button>
      </div>

      {/* Add Peer Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Federation Peer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-xs font-medium">Peer Name</label>
              <Input
                value={peerName}
                onChange={(e) => setPeerName(e.target.value)}
                placeholder="e.g., production-01"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">Endpoint</label>
              <Input
                value={peerEndpoint}
                onChange={(e) => setPeerEndpoint(e.target.value)}
                placeholder="https://peer.dmrx.example.com"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">Secret Reference (optional)</label>
              <Input
                value={peerSecret}
                onChange={(e) => setPeerSecret(e.target.value)}
                placeholder="env:DMRX_FEDERATION_SECRET"
              />
              <p className="text-[10px] text-fg-subtle">Reference to a secret for authentication (e.g., env:VAR_NAME)</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddPeer} loading={saving}>
                Add Peer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
