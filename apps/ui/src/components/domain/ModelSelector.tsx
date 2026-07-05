import {
  ChevronDown,
  Search,
  Star,
  StarOff,
  Settings,
  X,
  Sparkles,
  Brain,
  Eye,
  Wrench,
} from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';

import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/lib/utils';
import type { ApiModel, ApiProvider } from '@/types/api';

const LAST_USED_KEY = 'dmrx_last_used_model';
const FAVORITES_KEY = 'dmrx_favorite_models';

function getLastUsedModel(): { providerId: string; modelId: string } | null {
  try {
    const raw = localStorage.getItem(LAST_USED_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setLastUsedModel(providerId: string, modelId: string) {
  try {
    localStorage.setItem(LAST_USED_KEY, JSON.stringify({ providerId, modelId }));
  } catch { /* private browsing — ignore */ }
}

function getFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favs: string[]) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  } catch { /* private browsing — ignore */ }
}

interface ModelSelectorProps {
  providers: ApiProvider[];
  selectedProviderId?: string;
  selectedModelId?: string;
  onSelect: (providerId: string, modelId: string) => void;
  onOpenSettings?: (providerId: string) => void;
  className?: string;
  placeholder?: string;
}

export function ModelSelector({
  providers,
  selectedProviderId,
  selectedModelId,
  onSelect,
  onOpenSettings,
  className,
  placeholder = 'Select a model',
}: ModelSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const searchRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const [favorites, setFavorites] = React.useState<string[]>(getFavorites);
  const [dropdownPos, setDropdownPos] = React.useState({ top: 0, left: 0, width: 0 });

  const allModels = React.useMemo(() => {
    const items: Array<{ provider: ApiProvider; model: ApiModel; label: string }> = [];
    for (const provider of providers) {
      if (!provider.models) continue;
      for (const model of provider.models) {
        const label = model.displayName ?? model.name ?? model.modelId ?? model.id;
        items.push({ provider, model, label });
      }
    }
    return items;
  }, [providers]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return allModels;
    const q = search.toLowerCase();
    return allModels.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.model.modelId?.toLowerCase().includes(q) ||
        item.model.id.toLowerCase().includes(q) ||
        item.provider.name.toLowerCase().includes(q),
    );
  }, [allModels, search]);

  const grouped = React.useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const item of filtered) {
      const key = item.provider.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }, [filtered]);

  const favoriteItems = React.useMemo(
    () => allModels.filter((item) => favorites.includes(item.model.id)),
    [allModels, favorites],
  );

  const currentModel = React.useMemo(() => {
    if (!selectedProviderId || !selectedModelId) return null;
    return allModels.find(
      (item) => item.provider.id === selectedProviderId && item.model.id === selectedModelId,
    );
  }, [allModels, selectedProviderId, selectedModelId]);

  const updatePosition = React.useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: Math.max(rect.width, 320),
    });
  }, []);

  React.useEffect(() => {
    if (open) {
      updatePosition();
      setTimeout(() => searchRef.current?.focus(), 100);
    } else {
      setSearch('');
    }
  }, [open, updatePosition]);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (providerId: string, modelId: string) => {
    onSelect(providerId, modelId);
    setLastUsedModel(providerId, modelId);
    setOpen(false);
    setSearch('');
  };

  const handleToggleFavorite = (modelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = favorites.includes(modelId)
      ? favorites.filter((id) => id !== modelId)
      : [...favorites, modelId];
    saveFavorites(next);
    setFavorites(next);
  };

  const CapabilityBadges = ({ model }: { model: ApiModel }) => {
    const caps: Array<{ label: string; tone: string }> = [];
    if (model.supportsVision) caps.push({ label: 'vision', tone: 'info' });
    if (model.supportsToolUse) caps.push({ label: 'tools', tone: 'primary' });
    if (model.supportsReasoning) caps.push({ label: 'reasoning', tone: 'warning' });
    if (caps.length === 0) return null;
    return (
      <div className="flex items-center gap-1 shrink-0">
        {caps.map((c) => (
          <Badge key={c.label} tone={c.tone as any} size="sm">
            {c.label}
          </Badge>
        ))}
      </div>
    );
  };

  const ModelItem = ({
    item,
    showProvider = false,
  }: {
    item: (typeof allModels)[number];
    showProvider?: boolean;
  }) => {
    const isSelected = item.provider.id === selectedProviderId && item.model.id === selectedModelId;
    const isFav = favorites.includes(item.model.id);
    return (
      <div
        onClick={() => handleSelect(item.provider.id, item.model.id)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors',
          'hover:bg-surface-3',
          isSelected && 'bg-primary/10 border-l-2 border-primary',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {showProvider && (
              <span className="text-[10px] text-fg-subtle font-medium uppercase">
                {item.provider.name}
              </span>
            )}
            <span className="text-xs font-medium text-fg truncate">{item.label}</span>
          </div>
          <div className="text-[10px] text-fg-subtle font-mono mt-0.5 truncate">
            {item.model.modelId ?? item.model.id}
          </div>
        </div>
        <CapabilityBadges model={item.model} />
        <button
          onClick={(e) => handleToggleFavorite(item.model.id, e)}
          className="shrink-0 p-1 hover:bg-surface-2 rounded"
          aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          {isFav ? (
            <Star className="size-3 text-warning fill-warning" />
          ) : (
            <StarOff className="size-3 text-fg-subtle" />
          )}
        </button>
      </div>
    );
  };

  const dropdown = open
    ? createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-50 rounded-xl border border-border bg-surface-1 shadow-lg"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          <div className="border-b border-border px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full pl-7 pr-7 py-1.5 text-xs bg-transparent outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="size-3.5 text-fg-subtle" />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!search && favoriteItems.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[10px] font-semibold text-fg-subtle uppercase tracking-wider bg-surface-2/50">
                  Favorites
                </div>
                {favoriteItems.map((item) => (
                  <ModelItem key={`fav-${item.model.id}`} item={item} />
                ))}
                <div className="border-b border-border" />
              </>
            )}
            {Object.entries(grouped).map(([providerId, items]) => {
              const provider = items[0]?.provider;
              if (!provider) return null;
              return (
                <div key={providerId}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-fg-subtle uppercase tracking-wider bg-surface-2/50 flex items-center justify-between">
                    <span>{provider.name}</span>
                    {onOpenSettings && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSettings(providerId);
                          setOpen(false);
                        }}
                        className="p-0.5 hover:bg-surface-3 rounded"
                        title="Provider settings"
                      >
                        <Settings className="size-3 text-fg-subtle" />
                      </button>
                    )}
                  </div>
                  {items.map((item) => (
                    <ModelItem key={item.model.id} item={item} />
                  ))}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-fg-muted">
                No models found{search ? ` for "${search}"` : ''}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2',
          'hover:border-border-strong transition-colors text-left w-full',
          className,
        )}
      >
        {currentModel ? (
          <>
            <Sparkles className="size-3.5 text-primary shrink-0" />
            <span className="text-xs font-medium text-fg truncate flex-1">
              {currentModel.label}
            </span>
            <Badge tone="muted" size="sm">{currentModel.provider.name}</Badge>
          </>
        ) : (
          <span className="text-xs text-fg-muted flex-1">{placeholder}</span>
        )}
        <ChevronDown className="size-3.5 text-fg-subtle shrink-0" />
      </button>
      {dropdown}
    </>
  );
}
