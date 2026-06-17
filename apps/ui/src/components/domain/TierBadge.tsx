import * as React from 'react';
import { Zap, CreditCard, Layers, CircleOff, KeyRound, Crown } from 'lucide-react';
import { Badge } from '@/components/primitives/Badge';
import type { ProviderTier } from '@/types/api';

export interface TierBadgeProps {
  tier: ProviderTier | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Renders a single Free / Paid / Free+Paid / Subscription / No-key badge for a
 * provider connection. The tone mapping follows the existing Badge
 * component's vocabulary (success / warning / primary / muted) so
 * Free stays visually distinct from Paid.
 *
 * When `tier` is undefined (older server), we fall back to 'paid' so
 * the UI keeps working until the new field is rolled out everywhere.
 */
export function TierBadge({ tier, size = 'sm', className }: TierBadgeProps) {
  const resolved: ProviderTier = tier ?? 'paid';
  if (resolved === 'free') {
    return (
      <Badge tone="success" size={size} icon={<Zap className="size-2.5" />} className={className}>
        Free
      </Badge>
    );
  }
  if (resolved === 'paid') {
    return (
      <Badge tone="warning" size={size} icon={<CreditCard className="size-2.5" />} className={className}>
        Paid
      </Badge>
    );
  }
  if (resolved === 'mixed') {
    return (
      <Badge tone="primary" size={size} icon={<Layers className="size-2.5" />} className={className}>
        Free + Paid
      </Badge>
    );
  }
  if (resolved === 'subscription') {
    return (
      <Badge tone="info" size={size} icon={<Crown className="size-2.5" />} className={className}>
        Subscription
      </Badge>
    );
  }
  return (
    <Badge tone="muted" size={size} icon={<CircleOff className="size-2.5" />} className={className}>
      No key
    </Badge>
  );
}

/**
 * Compact tier label for a single key. The two-key tier vocabulary is
 * just 'free' and 'paid', so the mapping is simpler than TierBadge.
 */
export function KeyTierBadge({
  tier,
  size = 'sm',
  className,
}: {
  tier: 'free' | 'paid' | undefined;
  size?: 'sm' | 'md';
  className?: string;
}) {
  if (tier === 'free') {
    return (
      <Badge tone="success" size={size} icon={<Zap className="size-2.5" />} className={className}>
        Free
      </Badge>
    );
  }
  return (
    <Badge tone="warning" size={size} icon={<KeyRound className="size-2.5" />} className={className}>
      Paid
    </Badge>
  );
}
