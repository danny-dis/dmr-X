import { Plus, Search, MessageSquare } from 'lucide-react';
import * as React from 'react';

import { ConversationItem } from './ConversationItem';

import { Button } from '@/components/primitives/Button';
import { Input } from '@/components/primitives/Input';
import { useApiData } from '@/hooks/useApiData';
import { api } from '@/lib/api';
import { usePlaygroundStore } from '@/store/usePlaygroundStore';
import type { Conversation } from '@/store/usePlaygroundStore';

export function PlaygroundSidebar() {
  const showSidebar = usePlaygroundStore(s => s.showSidebar);
  const conversations = usePlaygroundStore(s => s.conversations);
  const currentConversationId = usePlaygroundStore(s => s.currentConversationId);
  const loadConversation = usePlaygroundStore(s => s.loadConversation);
  const createConversation = usePlaygroundStore(s => s.createConversation);
  
  const [searchQuery, setSearchQuery] = React.useState('');
  
  // Fetch conversations from API. Previously a raw `fetch` with a
  // hand-rolled Authorization header, bypassing the shared token
  // resolution (tenant token → admin token fallback) and base-URL/error
  // handling that `api()` provides everywhere else.
  const { data: conversationsData, isLoading } = useApiData(
    () => api<{ conversations: Conversation[] }>('/v1/conversations'),
    [],
    { refetchInterval: 30000 } // Refresh every 30 seconds
  );
  
  const filteredConversations = React.useMemo(() => {
    const convs = conversationsData?.conversations || conversations;
    if (!searchQuery) return convs;
    return convs.filter((c: any) => 
      c.title?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [conversationsData, conversations, searchQuery]);
  
  if (!showSidebar) return null;
  
  return (
    <aside className="fixed bottom-3 left-3 top-[76px] z-40 flex w-[min(300px,calc(100vw-1.5rem))] shrink-0 flex-col rounded-lg border border-border bg-surface-1 shadow-lg md:static md:inset-auto md:z-auto md:h-full md:w-[300px] md:rounded-none md:border-y-0 md:border-l-0 md:shadow-none">
      {/* Header */}
      <div className="border-b border-border p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-fg">Conversations</h2>
          <p className="text-xs text-fg-muted">Saved playground runs</p>
        </div>
        <Button 
          className="w-full" 
          onClick={() => createConversation()}
        >
          <Plus className="size-4" />
          New Chat
        </Button>
      </div>
      
      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-fg-muted" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      
      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-surface-3 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="mx-2 mt-6 flex h-36 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-2 text-fg-muted">
            <MessageSquare className="mb-2 size-8 opacity-50" />
            <p className="text-sm">No conversations yet</p>
            <button
              onClick={() => createConversation()}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Start your first conversation
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredConversations.map((conversation: any) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isActive={currentConversationId === conversation.id}
                onClick={() => loadConversation(conversation.id)}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="border-t border-border p-4">
        <div className="rounded-md bg-surface-2 px-3 py-2 text-center text-xs text-fg-muted">
          {filteredConversations.length} conversation(s)
        </div>
      </div>
    </aside>
  );
}
