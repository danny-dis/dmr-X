import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import * as React from 'react';

import { Button } from './Button';

import { cn } from '@/lib/utils';


export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total?: number;
  pageSize?: number;
  siblingCount?: number;
  className?: string;
}

const DOTS = 'DOTS' as const;

function buildPageRange(current: number, total: number, siblings: number): (number | typeof DOTS)[] {
  const totalNumbers = siblings * 2 + 5;
  if (total <= totalNumbers) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const leftSibling = Math.max(current - siblings, 1);
  const rightSibling = Math.min(current + siblings, total);
  const showLeftDots = leftSibling > 2;
  const showRightDots = rightSibling < total - 1;
  if (!showLeftDots && showRightDots) {
    const leftRange = Array.from({ length: 3 + 2 * siblings }, (_, i) => i + 1);
    return [...leftRange, DOTS, total];
  }
  if (showLeftDots && !showRightDots) {
    const rightRange = Array.from(
      { length: 3 + 2 * siblings },
      (_, i) => total - (3 + 2 * siblings) + i + 1
    );
    return [1, DOTS, ...rightRange];
  }
  return [1, DOTS, ...range(leftSibling, rightSibling), DOTS, total];
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  total,
  pageSize,
  siblingCount = 1,
  className,
}: PaginationProps) {
  const items = buildPageRange(page, totalPages, siblingCount);
  const start = total != null && pageSize != null ? (page - 1) * pageSize + 1 : null;
  const end = total != null && pageSize != null ? Math.min(page * pageSize, total) : null;

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3',
        className
      )}
    >
      {total != null && (
        <p className="text-xs text-fg-muted">
          Showing <span className="font-medium text-fg">{start}</span>–
          <span className="font-medium text-fg">{end}</span> of{' '}
          <span className="font-medium text-fg">{total.toLocaleString()}</span>
        </p>
      )}
      <div className="flex items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          aria-label="First page"
        >
          <ChevronsLeft className="size-3.5" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <div className="flex items-center gap-0.5">
          {items.map((it, i) =>
            it === DOTS ? (
              <span
                key={`dots-${i}`}
                className="size-7 inline-flex items-center justify-center text-fg-subtle text-xs"
              >
                …
              </span>
            ) : (
              <button
                key={it}
                onClick={() => onPageChange(it)}
                aria-current={it === page ? 'page' : undefined}
                className={cn(
                  'size-7 inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors',
                  it === page
                    ? 'bg-primary text-white'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                )}
              >
                {it}
              </button>
            )
          )}
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="size-3.5" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          aria-label="Last page"
        >
          <ChevronsRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
