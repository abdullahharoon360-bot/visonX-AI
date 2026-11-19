import * as React from 'react';
import { cn } from '@/src/lib/utils';

export interface TabOption<T extends string> {
  id: T;
  label: string;
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<TabOption<T>>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-800/90 bg-[#070D1A] p-1',
        className
      )}
    >
      {options.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70',
              active
                ? 'bg-[#13203B] text-cyan-200 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
