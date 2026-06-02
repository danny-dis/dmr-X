import { useEffect, useRef, useState, useCallback } from 'react';

export interface SseStatus {
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  lastEventAt: number | null;
  error: string | null;
}

export function useSSE<T = unknown>(
  url: string | null,
  onEvent?: (data: T) => void
): { status: SseStatus['status']; lastEventAt: number | null; error: string | null; reconnect: () => void } {
  const [status, setStatus] = useState<SseStatus['status']>('idle');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  const reconnect = useCallback(() => setReconnectKey((k) => k + 1), []);

  useEffect(() => {
    if (!url) {
      setStatus('idle');
      return;
    }
    setStatus('connecting');
    setError(null);
    const es = new EventSource(url);
    esRef.current = es;
    es.onopen = () => {
      setStatus('open');
      setError(null);
    };
    es.onmessage = (e) => {
      setLastEventAt(Date.now());
      try {
        const data = JSON.parse(e.data) as T;
        cbRef.current?.(data);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      setStatus('error');
      setError('Connection error');
    };
    return () => {
      es.close();
      esRef.current = null;
      setStatus('closed');
    };
  }, [url, reconnectKey]);

  return { status, lastEventAt, error, reconnect };
}
