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
  if (Array.isArray(tenant)) return { ok: false };
  return { ok: true, binding: { principalId, ...(tenant === undefined ? {} : { tenantKey: tenant }) } };
}

export class BoundSessionRegistry<T extends ClosableResource = ClosableResource> {
  private readonly sessions = new Map<string, { binding: SessionBinding; resource: T }>();

  constructor(private readonly maxSessions: number) {}

  add(id: string, binding: SessionBinding, resource: T): void | Promise<void> {
    if (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (oldest) this.sessions.delete(oldest);
    }
    this.sessions.set(id, { binding, resource });
  }

  get(id: string, _binding: SessionBinding): T | undefined {
    return this.sessions.get(id)?.resource;
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  async close(id: string): Promise<void> {
    const entry = this.sessions.get(id);
    if (!entry) return;
    this.sessions.delete(id);
    await entry.resource.server?.close?.();
  }
}
