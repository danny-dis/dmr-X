import { cn } from '@/lib/utils';
import { type ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: { value: number; positive: boolean };
  icon: ReactNode;
  index?: number;
  className?: string;
}

export default function StatCard({ title, value, subtitle, trend, icon, index = 0, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'glass-card rounded-xl p-5 hover:border-[#F7A51C]/30 transition-all duration-300',
        className
      )}
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-8 h-8 rounded-lg bg-[#F7A51C]/10 flex items-center justify-center">
          {icon}
        </div>
        {trend && (
          <span
            className={cn(
              'text-[11px] font-semibold px-2 py-0.5 rounded-full',
              trend.positive ? 'bg-[#00FFB2]/10 text-[#00FFB2]' : 'bg-[#FF4D6A]/10 text-[#FF4D6A]'
            )}
          >
            {trend.positive ? '+' : ''}{trend.value}%
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-[#F8F9FC] tracking-tight">
        {value}
      </div>
      <div className="text-xs text-[#595962] mt-0.5">{title}</div>
      {subtitle && (
        <div className="text-[11px] text-[#A6A6B0] mt-2 font-mono-data">{subtitle}</div>
      )}
    </div>
  );
}
