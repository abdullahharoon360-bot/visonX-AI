import * as React from 'react';
import { cn } from '@/src/lib/utils';

export function Surface({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-slate-800/90 bg-[#0B1222]',
        className
      )}
      {...props}
    />
  );
}

export function SurfaceHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col gap-1.5 px-6 py-5 border-b border-slate-800/80', className)}
      {...props}
    />
  );
}

export function SurfaceTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('font-display text-base font-semibold tracking-tight text-slate-100', className)}
      {...props}
    />
  );
}

export function SurfaceDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-sm text-slate-400', className)}
      {...props}
    />
  );
}

export function SurfaceBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6', className)} {...props} />;
}
