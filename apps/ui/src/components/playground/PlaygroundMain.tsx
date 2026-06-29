import * as React from 'react';

import { EmptyState } from './EmptyState';
import { MessageBubble } from './MessageBubble';
import { StreamingBubble } from './StreamingBubble';

import { cn } from '@/lib/utils';
import { usePlaygroundStore } from '@/store/usePlaygroundStore';

export function PlaygroundMain() {
  const messages = usePlaygroundStore(s => s.messages);
  const isStreaming = usePlaygroundStore(s => s.isStreaming);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);
  
  if (messages.length === 0) {
    return <EmptyState />;
  }
  
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[800px] mx-auto py-6 px-4">
        {messages.map((message) => (
          <div key={message.id}>
            {message.isStreaming ? (
              <StreamingBubble message={message} />
            ) : (
              <MessageBubble message={message} />
            )}
            {/* Event trace for agentic/tool-loop streams. The store fills
                `message.events` with parsed SSE events (turn, step,
                tool_calls, tool_results, error, done, etc.). Chat/image/
                tts/embed messages leave this array empty. */}
            {message.events && message.events.length > 0 && (
              <div className="ml-12 mt-1 space-y-1">
                {message.events.map((evt, i) => (
                  <div key={i} className="text-[10px] text-fg-muted font-mono break-all">
                    <span className="text-primary">{evt.name}</span>
                    <span className="opacity-70">
                      {' '}{JSON.stringify(evt.data).slice(0, 200)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}