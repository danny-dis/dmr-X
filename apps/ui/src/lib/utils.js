import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
export function formatNumber(n, opts) {
    return new Intl.NumberFormat('en-US', opts).format(n);
}
export function formatPercent(n, digits = 1) {
    return `${(n * 100).toFixed(digits)}%`;
}
export function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
}
export function noop() { }
export function unique(arr) {
    return Array.from(new Set(arr));
}
//# sourceMappingURL=utils.js.map