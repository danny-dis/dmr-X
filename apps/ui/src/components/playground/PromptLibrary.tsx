/**
 * PromptLibrary — browse and search L1B3RT4S prompts in the Playground.
 * Fetches from the /v1/prompts API endpoint.
 */

import * as React from 'react';
import { Search, BookOpen, Tag, ChevronRight, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface PromptEntry {
  id: string;
  provider: string;
  category: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
}

interface PromptLibraryProps {
  onSelectPrompt: (content: string) => void;
  disabled?: boolean;
}

export function PromptLibrary({ onSelectPrompt, disabled }: PromptLibraryProps) {
  const [prompts, setPrompts] = React.useState<PromptEntry[]>([]);
  const [providers, setProviders] = React.useState<string[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [selectedProvider, setSelectedProvider] = React.useState<string | null>(null);
  const [expandedPrompt, setExpandedPrompt] = React.useState<string | null>(null);

  // Fetch prompts from API on mount
  React.useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const [promptsRes, providersRes] = await Promise.all([
          api('/v1/prompts'),
          api('/v1/prompts/providers'),
        ]);
        setPrompts((promptsRes as any).prompts ?? []);
        setProviders((providersRes as any).providers ?? []);
      } catch {
        // API not available — use empty state
        setPrompts([]);
        setProviders([]);
      } finally {
        setIsLoading(false);
      }
    };
    fetchPrompts();
  }, []);

  const filteredPrompts = React.useMemo(() => {
    return prompts.filter(prompt => {
      const matchesSearch = !search ||
        prompt.title.toLowerCase().includes(search.toLowerCase()) ||
        prompt.description.toLowerCase().includes(search.toLowerCase()) ||
        prompt.tags.some(t => t.includes(search.toLowerCase()));
      const matchesProvider = !selectedProvider || prompt.provider === selectedProvider;
      return matchesSearch && matchesProvider;
    });
  }, [prompts, search, selectedProvider]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="size-4" />
            L1B3RT4S Prompt Library
          </CardTitle>
          <Badge tone="muted" size="sm">
            {isLoading ? <Loader2 className="size-3 animate-spin" /> : `${prompts.length} prompts`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompts..."
            className="h-8 pl-8 text-xs"
            disabled={disabled || isLoading}
          />
        </div>

        {/* Provider Filter */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setSelectedProvider(null)}
            disabled={disabled}
            className={cn(
              "px-2 py-1 text-xs rounded-md border transition-colors",
              !selectedProvider
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-surface-2/50 border-border text-muted-foreground hover:bg-surface-3/50"
            )}
          >
            All
          </button>
          {providers.map(provider => (
            <button
              key={provider}
              onClick={() => setSelectedProvider(provider)}
              disabled={disabled}
              className={cn(
                "px-2 py-1 text-xs rounded-md border transition-colors",
                selectedProvider === provider
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-surface-2/50 border-border text-muted-foreground hover:bg-surface-3/50"
              )}
            >
              {provider}
            </button>
          ))}
        </div>

        {/* Prompts List */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : filteredPrompts.length === 0 ? (
            <div className="text-center text-xs text-muted-foreground py-4">
              No prompts found
            </div>
          ) : (
            filteredPrompts.map(prompt => (
              <div
                key={prompt.id}
                className={cn(
                  "rounded-lg border transition-colors",
                  expandedPrompt === prompt.id
                    ? "bg-primary/5 border-primary/20"
                    : "bg-surface-2/30 border-border hover:bg-surface-2/50"
                )}
              >
                <div
                  className="flex items-center gap-2 p-2 cursor-pointer"
                  onClick={() => setExpandedPrompt(
                    expandedPrompt === prompt.id ? null : prompt.id
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{prompt.title}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {prompt.provider} · {prompt.category}
                    </div>
                  </div>
                  <ChevronRight className={cn(
                    "size-3 text-muted-foreground transition-transform",
                    expandedPrompt === prompt.id && "rotate-90"
                  )} />
                </div>

                {expandedPrompt === prompt.id && (
                  <div className="px-2 pb-2 space-y-2">
                    <div className="text-xs text-muted-foreground">{prompt.description}</div>
                    <div className="flex flex-wrap gap-1">
                      {prompt.tags.map(tag => (
                        <Badge key={tag} tone="muted" size="sm" className="text-[10px]">
                          <Tag className="size-2 mr-0.5" />
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <div className="p-2 rounded bg-surface-3/50 text-xs max-h-24 overflow-y-auto whitespace-pre-wrap">
                      {prompt.content}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onSelectPrompt(prompt.content)}
                      disabled={disabled}
                      className="w-full h-7 text-xs"
                    >
                      Use Prompt
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
