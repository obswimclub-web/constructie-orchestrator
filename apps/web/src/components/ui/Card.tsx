import { ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={twMerge(clsx('bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col', className))}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
      <div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function CardContent({ children, className, noPadding }: { children: ReactNode; className?: string; noPadding?: boolean }) {
  return (
    <div className={twMerge(clsx('flex-1', !noPadding && 'p-5', className))}>
      {children}
    </div>
  );
}
