import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';

import { cn } from '@/lib/utils';

interface BackLinkProps {
  to: string;
  label?: string;
  className?: string;
  /** Overrides `label`. Lets call sites write <BackLink to="/x">Label</BackLink>. */
  children?: React.ReactNode;
}

export function BackLink({ to, label = 'Back', className, children }: BackLinkProps) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors mb-4',
        className
      )}
    >
      <ArrowLeft className="size-3.5" />
      {children ?? label}
    </Link>
  );
}
