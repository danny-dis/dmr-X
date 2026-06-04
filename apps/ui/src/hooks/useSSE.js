import { useEffect, useRef, useState, useCallback } from 'react';
export function useSSE(url, onEvent) {
    const [status, setStatus] = useState('idle');
    const [lastEventAt, setLastEventAt] = useState(null);
    const [error, setError] = useState(null);
    const [reconnectKey, setReconnectKey] = useState(0);
    const esRef = useRef(null);
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
                const data = JSON.parse(e.data);
                cbRef.current?.(data);
            }
            catch {
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
//# sourceMappingURL=useSSE.js.map