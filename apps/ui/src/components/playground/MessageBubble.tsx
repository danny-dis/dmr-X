import * as React from 'react';
import { usePlaygroundStore, Message } from '@/store/usePlaygroundStore';
import { Admin } from '@/lib/admin';
import { Button } from '@/components/primitives/Button';
import { Copy, Check, ThumbsUp, ThumbsDown, RotateCcw, Clock, Zap, DollarSign, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration, formatTokens } from '@/lib/formatters';
import { Markdown } from '@/lib/markdown';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = React.useState(false);
  const [feedback, setFeedback] = React.useState<'up' | 'down' | null>(null);
  const regenerateMessage = usePlaygroundStore(s => s.regenerateMessage);
  const isStreaming = usePlaygroundStore(s => s.isStreaming);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      // ignore
    }
  };

  const handleFeedback = async (rating: 'up' | 'down') => {
    try {
      await Admin.submitFeedback({
        requestId: message.id,
        rating: rating === 'up' ? 1 : -1,
      });
      setFeedback(rating);
    } catch (error) {
      // ignore
    }
  };

  // Regenerate the assistant message by re-sending its preceding user
  // prompt. The store truncates the conversation, deletes the old
  // assistant row, and runs the same streaming pipeline as `sendMessage`.
  // Disabled while another stream is in flight so we don't fork two
  // requests into the same conversation.
  const handleRegenerate = () => {
    if (isStreaming) return;
    regenerateMessage(message.id);
  };

  return (
    <div className={cn('group flex gap-4 py-6', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary">
          <SparkleIcon />
        </div>
      )}

      <div className={cn(
        'max-w-[70%] rounded-2xl px-4 py-3 shadow-sm',
        isUser
          ? 'bg-primary text-white'
          : 'bg-surface-2 text-fg border border-border/60',
      )}>
        {isUser ? (
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</div>
        ) : (
          <Markdown source={message.content} />
        )}

        {message.imageUrl && (
          <img
            src={message.imageUrl}
            alt=""
            className="rounded-lg mt-2 max-h-[400px] object-contain bg-black"
          />
        )}

        {message.audioUrl && (
          <audio controls src={message.audioUrl} className="mt-2 w-full h-8" />
        )}

        {/* Metadata */}
        {!isUser && (message.latencyMs ?? 0) > 0 && (
          <div className="mt-3 pt-3 border-t border-border/60 flex flex-wrap items-center gap-4 text-[10px] text-fg-subtle">
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {formatDuration(message.latencyMs ?? 0)}
            </span>
            {(message.tokensInput || message.tokensOutput) ? (
              <span className="flex items-center gap-1">
                <Zap className="size-3" />
                {formatTokens((message.tokensInput ?? 0) + (message.tokensOutput ?? 0))}
              </span>
            ) : null}
            {message.cost !== undefined && message.cost > 0 ? (
              <span className="flex items-center gap-1">
                <DollarSign className="size-3" />
                {message.cost.toFixed(4)}
              </span>
            ) : null}
          </div>
        )}

        {/* Routing Decision */}
        {!isUser && message.routingDecision && (
          <div className="mt-3 pt-3 border-t border-border/60 flex items-start gap-2">
            <Info className="size-3 text-primary mt-0.5 shrink-0" />
            <div className="text-[10px] text-fg-muted leading-tight italic">
              Routing Decision: {message.routingDecision}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {!isUser && (
        <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCopy}
            className={cn(copied && 'text-primary')}
            aria-label="Copy message"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => handleFeedback('up')}
            className={cn(feedback === 'up' && 'text-success bg-success/10')}
            aria-label="Thumbs up"
          >
            <ThumbsUp className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => handleFeedback('down')}
            className={cn(feedback === 'down' && 'text-danger bg-danger/10')}
            aria-label="Thumbs down"
          >
            <ThumbsDown className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleRegenerate}
            disabled={isStreaming}
            aria-label="Regenerate"
            title="Regenerate"
          >
            <RotateCcw className="size-3" />
          </Button>
        </div>
      )}

      {isUser && (
        <div className="size-8 rounded-full bg-surface-3 flex items-center justify-center shrink-0 text-fg-muted">
          <UserIcon />
        </div>
      )}
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2zm6 10l1 2.5L21.5 16l-2.5 1L18 19.5 17 17l-2.5-1L17 14.5l1-2.5zM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3 0-9 1.5-9 4.5V21h18v-2.5c0-3-6-4.5-9-4.5z" />
    </svg>
  );
}
