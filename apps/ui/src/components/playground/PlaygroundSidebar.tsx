import { Plus, Search, MessageSquare } from 'lucide-react';
import * as React from 'react';

import { ConversationItem } from './ConversationItem';

import { Button } from '@/components/primitives/Button';
import { Input } from '@/components/primitives/Input';
import { useApiData } from '@/hooks/useApiData';
import { usePlaygroundStore } from '@/store/usePlaygroundStore';

export function PlaygroundSidebar() {
  const showSidebar = usePlaygroundStore(s => s.showSidebar);
  const conversations = usePlaygroundStore(s => s.conversations);
  const currentConversationId = usePlaygroundStore(s => s.currentConversationId);
  const loadConversation = usePlaygroundStore(s => s.loadConversation);
  const createConversation = usePlaygroundStore(s => s.createConversation);
  
  const [searchQuery, setSearchQuery] = React.useState('');
  
  // Fetch conversations from API
  const { data: conversationsData, isLoading } = useApiData(
    () => fetch('/v1/conversations', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('dmrx_tenant_token') || localStorage.getItem('dmrx_token') || ''}`,
      },
    }).then(r => r.json()),
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
    <div className="w-[260px] h-full border-r border-border bg-surface-2 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border">
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
      <div className="flex-1 overflow-y-auto px-2">
        {isLoading ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-surface-3 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-fg-muted">
            <MessageSquare className="size-8 mb-2 opacity-50" />
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
      <div className="p-4 border-t border-border">
        <div className="text-xs text-fg-muted text-center">
          {filteredConversations.length} conversation(s)
        </div>
      </div>
    </div>
  );
}