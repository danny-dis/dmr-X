import { useEffect, useRef, useState } from 'react';
export function useDebounce(value, delay = 250) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
}
export function useLocalStorage(key, initial) {
    const [value, setValue] = useState(() => {
        try {
            const stored = localStorage.getItem(key);
            return stored ? JSON.parse(stored) : initial;
        }
        catch {
            return initial;
        }
    });
    const set = (v) => {
        setValue((prev) => {
            const next = typeof v === 'function' ? v(prev) : v;
            try {
                localStorage.setItem(key, JSON.stringify(next));
            }
            catch {
                // ignore
            }
            return next;
        });
    };
    return [value, set];
}
export function useDebouncedCallback(fn, delay = 250) {
    const timer = useRef(null);
    const fnRef = useRef(fn);
    fnRef.current = fn;
    return (...args) => {
        if (timer.current)
            clearTimeout(timer.current);
        timer.current = setTimeout(() => fnRef.current(...args), delay);
    };
}
export function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => typeof window === 'undefined' ? false : window.matchMedia(query).matches);
    useEffect(() => {
        const mql = window.matchMedia(query);
        const handler = (e) => setMatches(e.matches);
        mql.addEventListener('change', handler);
        setMatches(mql.matches);
        return () => mql.removeEventListener('change', handler);
    }, [query]);
    return matches;
}
export function useBreakpoint() {
    const isMd = useMediaQuery('(min-width: 768px)');
    const isLg = useMediaQuery('(min-width: 1024px)');
    const isXl = useMediaQuery('(min-width: 1280px)');
    const is2xl = useMediaQuery('(min-width: 1536px)');
    if (is2xl)
        return '2xl';
    if (isXl)
        return 'xl';
    if (isLg)
        return 'lg';
    if (isMd)
        return 'md';
    return 'sm';
}
//# sourceMappingURL=useMisc.js.map