import { Square } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/primitives/Button';
import { Markdown } from '@/lib/markdown';
import { usePlaygroundStore, Message } from '@/store/usePlaygroundStore';

interface StreamingBubbleProps {
  message: Message;
}

function StreamingBubbleComponent({ message }: StreamingBubbleProps) {
  const { cancelStreaming } = usePlaygroundStore();

  return (
    <div className="group flex gap-4 py-6 justify-start">
      <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary">
        <SparkleIcon />
      </div>

      <div className="max-w-[70%] rounded-2xl px-4 py-3 bg-surface-2 text-fg border border-border/60 shadow-sm">
        {message.content ? (
          <>
            <Markdown source={message.content} />
            <span
              className="inline-block w-2 h-3.5 align-middle bg-primary ml-0.5 -mb-0.5 animate-pulse"
              aria-hidden
            />
          </>
        ) : (
          <div className="flex items-center gap-1.5 py-1">
            <span
              className="size-1.5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="size-1.5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="size-1.5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </div>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={cancelStreaming}
        className="shrink-0 self-start mt-2"
        aria-label="Stop generating"
      >
        <Square className="size-3" />
      </Button>
    </div>
  );
}

export const StreamingBubble = React.memo(StreamingBubbleComponent);

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2zm6 10l1 2.5L21.5 16l-2.5 1L18 19.5 17 17l-2.5-1L17 14.5l1-2.5zM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14z" />
    </svg>
  );
}
