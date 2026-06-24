import { ChevronRight } from 'lucide-react';
import * as React from 'react';
import { Link, useLocation } from 'react-router';

import { findGroup } from '@/constants/nav';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; path?: string }[];
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  const location = useLocation();
  const group = findGroup(location.pathname);
  const crumbs =
    breadcrumbs ??
    (group ? [{ label: group.label }, { label: title }] : [{ label: title }]);

  return (
    <div className={cn('flex flex-col gap-2 pb-4 border-b border-border', className)}>
      <nav className="flex items-center gap-1 text-[11px] text-fg-muted">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight className="size-3 text-fg-subtle" />}
            {c.path ? (
              <Link to={c.path} className="hover:text-fg transition-colors">
                {c.label}
              </Link>
            ) : (
              <span className={i === crumbs.length - 1 ? 'text-fg' : ''}>{c.label}</span>
            )}
          </React.Fragment>
        ))}
      </nav>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {icon && (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-2 text-primary">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-fg tracking-tight">{title}</h1>
            {description && (
              <p className="text-xs text-fg-muted mt-1 leading-relaxed">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
