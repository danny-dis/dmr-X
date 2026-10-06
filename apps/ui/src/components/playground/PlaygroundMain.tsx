import * as React from 'react';

import { EmptyState } from './EmptyState';
import { MessageBubble } from './MessageBubble';
import { StreamingBubble } from './StreamingBubble';
import { StepTrace } from './StepTrace';

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
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[960px] px-4 py-6 sm:px-6">
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
              <StepTrace events={message.events} />
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
