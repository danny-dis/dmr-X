import { AlertTriangle, RefreshCw } from 'lucide-react';
import * as React from 'react';

interface LoadingTimeoutProps {
  children: React.ReactNode;
  timeoutMs?: number;
  onRetry?: () => void;
}

export function LoadingTimeout({
  children,
  timeoutMs = 15000,
  onRetry,
}: LoadingTimeoutProps) {
  const [timedOut, setTimedOut] = React.useState(false);

  React.useEffect(() => {
    setTimedOut(false);
    const id = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(id);
  }, [timeoutMs]);

  if (!timedOut) return children;

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <AlertTriangle className="size-5 text-warning" />
      <p className="text-sm text-fg-muted">
        Taking longer than expected...
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-hover transition-colors"
        >
          <RefreshCw className="size-3" />
          Retry
        </button>
      )}
    </div>
  );
}
