export function formatCurrency(n: number, currency = 'USD'): string {
  if (!Number.isFinite(n)) return '—';
  const big = Math.abs(n) >= 1;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: big ? 0 : 2,
    maximumFractionDigits: big ? 2 : 4,
  }).format(n);
}

export function formatCompactCurrency(n: number, currency = 'USD'): string {
  return formatCurrency(n, currency);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)), BYTE_UNITS.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${BYTE_UNITS[i]}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 0) return '—';
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

export function formatTokens(n: number, compact = false): string {
  if (!compact) {
    return new Intl.NumberFormat('en-US').format(n);
  }
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatNumber(n: number, compact = false, decimals = 1): string {
  if (!Number.isFinite(n)) return '—';
  if (!compact) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
  }
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(decimals)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(decimals)}K`;
  return String(n);
}

export function formatPercent(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(decimals)}%`;
}

export function formatRate(n: number, unit: string, perSec = true): string {
  return `${formatNumber(n, true)} ${unit}${perSec ? '/s' : ''}`;
}

export function formatLatency(p50: number, p95: number, p99: number): string {
  return `p50 ${formatDuration(p50)} · p95 ${formatDuration(p95)} · p99 ${formatDuration(p99)}`;
}

export function timeAgo(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return `${Math.max(0, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatTime(iso: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-US', opts ?? { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

export function formatDate(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function formatDateTime(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function maskKey(key: string, visible = 4): string {
  if (!key) return '';
  if (key.length <= visible * 2) return '•'.repeat(key.length);
  return `${key.slice(0, visible)}…${key.slice(-visible)}`;
}

export function truncate(str: string, max = 80): string {
  if (!str) return '';
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1)}…`;
}
