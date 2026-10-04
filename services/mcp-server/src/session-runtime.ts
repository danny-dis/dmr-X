export interface SessionBinding {
  principalId: string;
  tenantKey?: string;
}

interface ClosableResource {
  transport?: { close?: () => void | Promise<void> };
  server?: { close?: () => void | Promise<void> };
}

export function readSessionBinding(
  headers: Record<string, string | string[] | undefined>,
  principalId: string,
): { ok: true; binding: SessionBinding } | { ok: false } {
  const tenant = headers['x-dmr-tenant-key'];
  // An array value means the client sent the header more than once (or the
  // runtime joined repeats). Either way the downstream tenant is ambiguous,
  // so reject rather than guess or silently rebind.
  if (Array.isArray(tenant)) return { ok: false };
  if (tenant === undefined) return { ok: true, binding: { principalId } };
  if (typeof tenant !== 'string') return { ok: false };
  const trimmed = tenant.trim();
  if (trimmed.length === 0) return { ok: true, binding: { principalId } };
  return { ok: true, binding: { principalId, tenantKey: trimmed } };
}

function sameBinding(a: SessionBinding, b: SessionBinding): boolean {
  if (a.principalId !== b.principalId) return false;
  return (a.tenantKey ?? undefined) === (b.tenantKey ?? undefined);
}

export class BoundSessionRegistry<T extends ClosableResource = ClosableResource> {
  private readonly sessions = new Map<string, { binding: SessionBinding; resource: T }>();
  private readonly closedIds = new Set<string>();

  constructor(private readonly maxSessions: number) {}

  async add(id: string, binding: SessionBinding, resource: T): Promise<void> {
    const existing = this.sessions.get(id);
    if (existing) {
      this.sessions.delete(id);
      await closeBoth(id, existing.resource, this.closedIds);
    }
    if (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (oldest) {
        const evicted = this.sessions.get(oldest);
        this.sessions.delete(oldest);
        if (evicted) await closeBoth(oldest, evicted.resource, this.closedIds);
      }
    }
    this.sessions.set(id, { binding, resource });
    this.closedIds.delete(id);
  }

  get(id: string, binding: SessionBinding): T | undefined {
    const entry = this.sessions.get(id);
    if (!entry) return undefined;
    if (!sameBinding(entry.binding, binding)) return undefined;
    return entry.resource;
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  async close(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (!entry) return;
    this.sessions.delete(id);
    await closeBoth(id, entry.resource, this.closedIds);
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      await this.close(id);
    }
  }
}

async function closeBoth<T extends ClosableResource>(
  id: string,
  resource: T,
  closedIds: Set<string>,
): Promise<void> {
  // Exactly-once: eviction and explicit close race on the same id during
  // init-failure cleanup and shutdown drain. The first closer wins; later
  // calls are no-ops so transport.close/server.close each run at most once.
  if (closedIds.has(id)) return;
  closedIds.add(id);
  try {
    await resource.transport?.close?.();
  } catch { /* best-effort: still close the server below */ }
  try {
    await resource.server?.close?.();
  } catch { /* best-effort */ }
}
