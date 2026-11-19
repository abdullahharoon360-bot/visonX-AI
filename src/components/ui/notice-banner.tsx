import * as React from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/src/lib/utils';

type NoticeTone = 'info' | 'warning' | 'error' | 'success';

interface NoticeBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: NoticeTone;
  title: string;
  description?: string;
}

const toneClasses: Record<NoticeTone, string> = {
  info: 'border-cyan-500/30 bg-cyan-950/20 text-cyan-100',
  warning: 'border-amber-500/35 bg-amber-950/20 text-amber-100',
  error: 'border-red-500/35 bg-red-950/25 text-red-100',
  success: 'border-emerald-500/35 bg-emerald-950/20 text-emerald-100',
};

const toneIconMap: Record<NoticeTone, React.ComponentType<{ className?: string }>> = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
  success: CheckCircle2,
};

export function NoticeBanner({
  tone = 'info',
  title,
  description,
  className,
  children,
  ...props
}: NoticeBannerProps) {
  const Icon = toneIconMap[tone];
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm',
        toneClasses[tone],
        className
      )}
      {...props}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-90" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium leading-snug">{title}</p>
        {description && <p className="text-xs opacity-85 leading-relaxed">{description}</p>}
        {children}
      </div>
    </div>
  );
}
