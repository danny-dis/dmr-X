import { useEffect, useRef, useState, useCallback } from 'react';
import { ApiError } from '@/lib/api';

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseApiDataResult<T> {
  data: T | null;
  error: ApiError | null;
  status: FetchStatus;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => Promise<void>;
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void;
}

export function useApiData<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
  options?: { enabled?: boolean; refetchInterval?: number | false },
): UseApiDataResult<T> {
  const enabled = options?.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [status, setStatus] = useState<FetchStatus>('idle');
  const mounted = useRef(true);
  const reqId = useRef(0);

  const run = useCallback(async () => {
    const id = ++reqId.current;
    setStatus('loading');
    setError(null);
    try {
      const res = await fetcher();
      if (mounted.current && id === reqId.current) {
        setData(res);
        setStatus('success');
      }
    } catch (e) {
      if (mounted.current && id === reqId.current) {
        setError(e instanceof ApiError ? e : new ApiError(String(e), 0, null));
        setStatus('error');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mounted.current = true;
    if (enabled) void run();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    const interval = options?.refetchInterval;
    if (!interval || interval <= 0) return;
    const t = setInterval(() => {
      void run();
    }, interval);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.refetchInterval, ...deps]);

  return {
    data,
    error,
    status,
    isLoading: status === 'loading' || status === 'idle',
    isError: status === 'error',
    isSuccess: status === 'success',
    refetch: run,
    setData,
  };
}
