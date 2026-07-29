import {
  Boxes,
  Brain,
  Bug,
  Check,
  Cloud,
  Container,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  GitBranch,
  Github,
  Gitlab,
  Globe,
  HardDrive,
  ListTodo,
  MessageSquare,
  MousePointerClick,
  Package,
  Search,
  Server,
  TestTube,
  Workflow,
} from 'lucide-react';
import * as React from 'react';

import { InstallDialog } from './InstallDialog';
import { McpNav } from './McpNav';

import { PageContainer, PageHeader } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useMcpCatalog, useMcpServers, type McpCatalogEntry } from '@/lib/queries/mcp';
import { cn } from '@/lib/utils';

/**
 * Icons referenced by the catalog, mapped explicitly.
 *
 * The catalog stores an icon *name* so it can stay a plain data module shared
 * with the server. Resolving that name via `import * as Icons from
 * 'lucide-react'` works but defeats tree-shaking — it pulled the entire icon
 * set into this chunk and took it past 800 kB. Listing the ones actually used
 * keeps the bundle proportional to the catalog.
 */
const CATALOG_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Boxes, Brain, Bug, Cloud, Container, Database, FileText, FolderOpen,
  GitBranch, Github, Gitlab, Globe, HardDrive, ListTodo, MessageSquare,
  MousePointerClick, Search, Server, TestTube, Workflow,
};

function CatalogIcon({ name, className }: { name: string; className?: string }) {
  // Package is the fallback for a catalog entry naming an icon not listed
  // above — a missing glyph should not blank the card.
  const Resolved = CATALOG_ICONS[name] ?? Package;
  return <Resolved className={className} />;
}

export function McpDiscoverPage() {
  const catalog = useMcpCatalog();
  const installed = useMcpServers();
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<McpCatalogEntry | null>(null);

  const installedIds = React.useMemo(
    () => new Set((installed.data?.servers ?? []).map((s) => s.id)),
    [installed.data],
  );

  const entries = catalog.data?.entries ?? [];
  const categories = catalog.data?.categories ?? {};

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (category && e.category !== category) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.id.includes(q)
      );
    });
  }, [entries, search, category]);

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Discover MCP Servers"
        description="A curated catalog that ships with DMR-X — no network call, so it works offline."
        icon={<Search className="size-5 text-primary" />}
      />

      <McpNav />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search servers…"
          prefix={<Search className="size-3.5" />}
          className="w-64"
        />
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={category === null ? 'secondary' : 'ghost'}
            onClick={() => setCategory(null)}
          >
            All
          </Button>
          {Object.entries(categories).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={category === key ? 'secondary' : 'ghost'}
              onClick={() => setCategory(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {catalog.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-fg-muted">
          No catalog entry matches “{search}”. You can still add it manually from the Servers tab.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((entry) => {
            const isInstalled = installedIds.has(entry.id);
            return (
              <Card
                key={entry.id}
                className={cn('flex flex-col p-4', !isInstalled && 'transition-colors hover:border-border-2')}
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-muted">
                    <CatalogIcon name={entry.icon} className="size-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-fg">{entry.name}</span>
                      {entry.official && (
                        <Badge tone="info" variant="soft" size="sm">
                          Official
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-muted">
                      {entry.description}
                    </p>
                  </div>
                </div>

                <div className="mt-auto flex items-center gap-2 pt-3">
                  {isInstalled ? (
                    <Button size="sm" variant="ghost" disabled leftIcon={<Check className="size-3.5" />}>
                      Installed
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setSelected(entry)}>
                      Install
                    </Button>
                  )}
                  {entry.requiredEnv.length > 0 && !isInstalled && (
                    <span className="text-2xs text-fg-subtle">
                      needs {entry.requiredEnv.filter((v) => !v.optional).length} value
                      {entry.requiredEnv.filter((v) => !v.optional).length === 1 ? '' : 's'}
                    </span>
                  )}
                  {entry.docsUrl && (
                    <a
                      href={entry.docsUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-auto text-fg-subtle transition-colors hover:text-fg"
                      aria-label={`${entry.name} documentation`}
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <InstallDialog entry={selected} onClose={() => setSelected(null)} />
    </PageContainer>
  );
}
