import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router';
import { chatCompletionStream, listModels, type OpenAIModel, type ChatMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Send, Bot, User, Zap, Clock, Hash, Loader2, ChevronDown,
  Plus, MessageSquare, Trash2, PanelLeftClose, PanelLeft,
} from 'lucide-react';

interface DisplayMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
  latency?: number;
  tokens?: number;
}

interface Conversation {
  id: string;
  title: string;
  messages: DisplayMessage[];
  createdAt: number;
  updatedAt: number;
  model?: string;
}

const STORAGE_KEY = 'dmr-x-conversations';
const ACTIVE_KEY = 'dmr-x-active-conversation';

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

function loadActiveId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

function saveActiveId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function generateTitle(firstMessage: string): string {
  const text = firstMessage.replace(/\n/g, ' ').trim();
  return text.length > 50 ? text.slice(0, 50) + '...' : text || 'New Chat';
}

export default function Playground() {
  const location = useLocation();

  // Conversations state
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId());
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Chat state
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [models, setModels] = useState<OpenAIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeConversation = conversations.find((c) => c.id === activeId) || null;
  const messages = activeConversation?.messages ?? [];

  // Persist conversations on change
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  // Persist active id on change
  useEffect(() => {
    saveActiveId(activeId);
  }, [activeId]);

  // Load models
  useEffect(() => {
    listModels()
      .then((m) => {
        setModels(m);
        const preselectedName = location.state?.modelName;
        if (preselectedName && m.find((x) => x.id === preselectedName)) {
          setSelectedModel(preselectedName);
        } else if (m.length > 0) {
          setSelectedModel(m[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, [location.state?.modelName]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // If no active conversation on load, create one (unless we have existing ones)
  useEffect(() => {
    if (conversations.length === 0) {
      createNewChat();
    } else if (!activeId) {
      setActiveId(conversations[0].id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createNewChat = useCallback(() => {
    const id = generateId();
    const now = Date.now();
    const conv: Conversation = {
      id,
      title: 'New Chat',
      messages: [],
      createdAt: now,
      updatedAt: now,
      model: selectedModel || undefined,
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(id);
    setInput('');
  }, [selectedModel]);

  const deleteConversation = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (activeId === id) {
          if (next.length > 0) {
            setActiveId(next[0].id);
          } else {
            // Will create a new one via effect
            setActiveId(null);
          }
        }
        return next;
      });
    },
    [activeId],
  );

  const switchConversation = useCallback((id: string) => {
    setActiveId(id);
    setInput('');
  }, []);

  const updateActiveConversation = useCallback(
    (updater: (conv: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeId ? updater(c) : c)),
      );
    },
    [activeId],
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming || !activeConversation) return;

    const userMsg: DisplayMessage = { role: 'user', content: text, timestamp: Date.now() };

    // Add user message and update title if first message
    updateActiveConversation((conv) => ({
      ...conv,
      title: conv.messages.length === 0 ? generateTitle(text) : conv.title,
      messages: [...conv.messages, userMsg],
      updatedAt: Date.now(),
      model: selectedModel || conv.model,
    }));

    setInput('');
    setIsStreaming(true);

    const currentMessages = activeConversation.messages;
    const startTime = Date.now();
    const chatMessages: ChatMessage[] = [...currentMessages, userMsg]
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    let assistantMsg: DisplayMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model: selectedModel || undefined,
    };

    // Add empty assistant message
    updateActiveConversation((conv) => ({
      ...conv,
      messages: [...conv.messages, assistantMsg],
    }));

    await chatCompletionStream(
      { model: selectedModel || undefined, messages: chatMessages },
      (text) => {
        assistantMsg = { ...assistantMsg, content: text };
        updateActiveConversation((conv) => {
          const msgs = [...conv.messages];
          msgs[msgs.length - 1] = { ...assistantMsg };
          return { ...conv, messages: msgs, updatedAt: Date.now() };
        });
      },
      (fullText) => {
        assistantMsg = {
          ...assistantMsg,
          content: fullText,
          latency: Date.now() - startTime,
          tokens: fullText.split(/\s+/).length,
        };
        updateActiveConversation((conv) => {
          const msgs = [...conv.messages];
          msgs[msgs.length - 1] = { ...assistantMsg };
          return { ...conv, messages: msgs, updatedAt: Date.now() };
        });
        setIsStreaming(false);
      },
      (err) => {
        assistantMsg = { ...assistantMsg, content: `Error: ${err.message}` };
        updateActiveConversation((conv) => {
          const msgs = [...conv.messages];
          msgs[msgs.length - 1] = { ...assistantMsg };
          return { ...conv, messages: msgs, updatedAt: Date.now() };
        });
        setIsStreaming(false);
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  function formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="flex h-[calc(100vh-8rem)]">
      {/* Sidebar */}
      <div
        className={cn(
          'flex flex-col border-r border-[#27272E] transition-all duration-200 flex-shrink-0',
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden',
        )}
      >
        {/* New Chat Button */}
        <div className="p-3">
          <button
            onClick={createNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[#F7A51C]/10 text-[#F7A51C] text-xs font-medium hover:bg-[#F7A51C]/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => switchConversation(conv.id)}
              className={cn(
                'group w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors',
                conv.id === activeId
                  ? 'bg-[#1A1A20] text-[#F8F9FC]'
                  : 'text-[#595962] hover:text-[#A6A6B0] hover:bg-[#1A1A20]/50',
              )}
            >
              <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs truncate">{conv.title}</div>
                <div className="text-[10px] text-[#595962]">
                  {formatRelativeTime(conv.updatedAt)}
                  {conv.messages.length > 0 && ` · ${conv.messages.length} msgs`}
                </div>
              </div>
              <button
                onClick={(e) => deleteConversation(conv.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#27272E] text-[#595962] hover:text-[#FF6B6B] transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </button>
          ))}
          {conversations.length === 0 && (
            <div className="px-3 py-6 text-center text-[10px] text-[#595962]">
              No conversations yet
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg text-[#595962] hover:text-[#A6A6B0] hover:bg-[#1A1A20] transition-colors"
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeft className="w-4 h-4" />
              )}
            </button>
            <div>
              <h1 className="text-xl font-bold text-[#F8F9FC]">Playground</h1>
              <p className="text-xs text-[#595962] mt-0.5">
                Test chat completions through the DMR-X router
              </p>
            </div>
          </div>

          {/* Model Selector */}
          <div className="relative">
            <button
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              className="flex items-center gap-2 px-3 py-2 glass-card rounded-lg text-sm text-[#A6A6B0] hover:text-[#F8F9FC] transition-colors"
            >
              <Zap className="w-3.5 h-3.5 text-[#F7A51C]" />
              {modelsLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <span className="font-mono-data text-xs">
                  {selectedModel || 'No models'}
                </span>
              )}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {modelDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 max-h-64 overflow-y-auto glass-card rounded-lg border border-[#27272E] z-50 shadow-xl">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setSelectedModel(m.id);
                      setModelDropdownOpen(false);
                    }}
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs font-mono-data hover:bg-[#1A1A20] transition-colors',
                      selectedModel === m.id
                        ? 'text-[#F7A51C] bg-[#F7A51C]/5'
                        : 'text-[#A6A6B0]',
                    )}
                  >
                    {m.id}
                  </button>
                ))}
                {models.length === 0 && !modelsLoading && (
                  <div className="px-3 py-4 text-xs text-[#595962] text-center">
                    No models available
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#F7A51C]/10 flex items-center justify-center mb-4">
                <Bot className="w-8 h-8 text-[#F7A51C]" />
              </div>
              <h3 className="text-sm font-semibold text-[#F8F9FC] mb-1">
                DMR-X Chat Playground
              </h3>
              <p className="text-xs text-[#595962] max-w-sm">
                Send a message to test the routing engine. The router will select
                the best model and provider based on your request.
              </p>
              {selectedModel && (
                <p className="text-[11px] text-[#F7A51C] font-mono-data mt-3">
                  Routing to: {selectedModel}
                </p>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-3',
                msg.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-lg bg-[#F7A51C]/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-3.5 h-3.5 text-[#F7A51C]" />
                </div>
              )}

              <div
                className={cn(
                  'max-w-[75%] rounded-xl px-4 py-3',
                  msg.role === 'user'
                    ? 'bg-[#F7A51C]/15 border border-[#F7A51C]/20 text-[#F8F9FC]'
                    : 'glass-card text-[#A6A6B0]',
                )}
              >
                <div className="text-sm whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                </div>

                {/* Metadata */}
                {msg.role === 'assistant' && msg.latency && (
                  <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[#27272E]/50">
                    {msg.model && (
                      <div className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-[#F7A51C]" />
                        <span className="text-[10px] text-[#595962] font-mono-data">
                          {msg.model}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-[#595962]" />
                      <span className="text-[10px] text-[#595962] font-mono-data">
                        {msg.latency}ms
                      </span>
                    </div>
                    {msg.tokens && (
                      <div className="flex items-center gap-1">
                        <Hash className="w-3 h-3 text-[#595962]" />
                        <span className="text-[10px] text-[#595962] font-mono-data">
                          ~{msg.tokens} tokens
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-lg bg-[#27272E] flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-3.5 h-3.5 text-[#A6A6B0]" />
                </div>
              )}
            </div>
          ))}

          {isStreaming && messages[messages.length - 1]?.content === '' && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-lg bg-[#F7A51C]/10 flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="w-3.5 h-3.5 text-[#F7A51C]" />
              </div>
              <div className="glass-card rounded-xl px-4 py-3">
                <Loader2 className="w-4 h-4 text-[#F7A51C] animate-spin" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="glass-card rounded-xl p-3">
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a message to the router..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-[#F8F9FC] placeholder-[#595962] resize-none outline-none min-h-[36px] max-h-[120px]"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className={cn(
                'w-9 h-9 rounded-lg flex items-center justify-center transition-all flex-shrink-0',
                input.trim() && !isStreaming
                  ? 'bg-[#F7A51C] text-[#060608] hover:bg-[#F7A51C]/90'
                  : 'bg-[#27272E] text-[#595962] cursor-not-allowed',
              )}
            >
              {isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#27272E]/50">
            <span className="text-[10px] text-[#595962]">
              {selectedModel ? `Model: ${selectedModel}` : 'Select a model above'}
            </span>
            <span className="text-[10px] text-[#595962]">
              Enter to send &middot; Shift+Enter for newline
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
