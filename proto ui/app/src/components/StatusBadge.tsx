import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

const statusMap: Record<string, { color: string; label: string }> = {
  active: { color: 'bg-[#00FFB2]', label: 'Active' },
  inactive: { color: 'bg-[#595962]', label: 'Inactive' },
  healthy: { color: 'bg-[#00FFB2]', label: 'Healthy' },
  degraded: { color: 'bg-[#F7A51C]', label: 'Degraded' },
  unavailable: { color: 'bg-[#FF4D6A]', label: 'Unavailable' },
  maintenance: { color: 'bg-[#00E0FF]', label: 'Maintenance' },
  operational: { color: 'bg-[#00FFB2]', label: 'Operational' },
  success: { color: 'bg-[#00FFB2]', label: 'Success' },
  error: { color: 'bg-[#FF4D6A]', label: 'Error' },
  warning: { color: 'bg-[#F7A51C]', label: 'Warning' },
  info: { color: 'bg-[#00E0FF]', label: 'Info' },
  fallback: { color: 'bg-[#F7A51C]', label: 'Fallback' },
  retry: { color: 'bg-[#00E0FF]', label: 'Retry' },
  running: { color: 'bg-[#00FFB2]', label: 'Running' },
  completed: { color: 'bg-[#00FFB2]', label: 'Completed' },
  failed: { color: 'bg-[#FF4D6A]', label: 'Failed' },
  queued: { color: 'bg-[#00E0FF]', label: 'Queued' },
  quarantined: { color: 'bg-[#FF4D6A]', label: 'Quarantined' },
  enabled: { color: 'bg-[#00FFB2]', label: 'Enabled' },
  disabled: { color: 'bg-[#595962]', label: 'Disabled' },
  beta: { color: 'bg-[#00E0FF]', label: 'Beta' },
  revoked: { color: 'bg-[#FF4D6A]', label: 'Revoked' },
  expired: { color: 'bg-[#595962]', label: 'Expired' },
  suspended: { color: 'bg-[#FF4D6A]', label: 'Suspended' },
  pending: { color: 'bg-[#F7A51C]', label: 'Pending' },
  stale: { color: 'bg-[#F7A51C]', label: 'Stale' },
  synced: { color: 'bg-[#00FFB2]', label: 'Synced' },
  syncing: { color: 'bg-[#00E0FF]', label: 'Syncing' },
  offline: { color: 'bg-[#FF4D6A]', label: 'Offline' },
  idle: { color: 'bg-[#00E0FF]', label: 'Idle' },
  terminating: { color: 'bg-[#F7A51C]', label: 'Terminating' },
  terminated: { color: 'bg-[#595962]', label: 'Terminated' },
  critical: { color: 'bg-[#FF4D6A]', label: 'Critical' },
  low: { color: 'bg-[#00FFB2]', label: 'Low' },
  medium: { color: 'bg-[#F7A51C]', label: 'Medium' },
  high: { color: 'bg-[#FF4D6A]', label: 'High' },
  premium: { color: 'bg-[#F7A51C]', label: 'Premium' },
};

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const mapped = statusMap[status.toLowerCase()] || { color: 'bg-[#595962]', label: status };

  return (
    <span className={cn('inline-flex items-center gap-1.5', size === 'sm' ? 'text-[11px]' : 'text-xs')}>
      <span className={cn('rounded-full', mapped.color, size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2')} />
      <span className="text-[#A6A6B0] font-medium">{mapped.label}</span>
    </span>
  );
}
