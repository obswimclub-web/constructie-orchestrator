import { ReactNode } from 'react';
import { clsx } from 'clsx';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'governance';

export function Badge({ children, variant = 'neutral' }: { children: ReactNode; variant?: BadgeVariant }) {
  const variants = {
    success: 'bg-green-100 text-green-700 border-green-200',
    warning: 'bg-amber-100 text-amber-700 border-amber-200',
    danger: 'bg-red-100 text-red-700 border-red-200',
    info: 'bg-blue-100 text-blue-700 border-blue-200',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    governance: 'bg-purple-100 text-purple-700 border-purple-200',
  };

  return (
    <span className={clsx('px-2.5 py-0.5 rounded-full text-xs font-semibold border', variants[variant])}>
      {children}
    </span>
  );
}
