import { Link } from 'react-router-dom';
import { Layers } from 'lucide-react';
import { PLATFORM_MODULES } from '@/src/data/rbacReference';
import { Button } from '@/src/components/ui/button';
import {
  Surface,
  SurfaceBody,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
} from '@/src/components/ui/surface';

export function PlannedModulePage({ moduleId }: { moduleId: string }) {
  const spec = PLATFORM_MODULES.find((m) => m.id === moduleId);

  if (!spec) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
          {spec.title}
        </h1>
        <p className="text-sm text-slate-400">
          Scheduled Module · Phase {spec.phase} · {spec.backendBoundary}
        </p>
      </div>

      <Surface className="max-w-3xl">
        <SurfaceHeader>
          <div className="flex items-center gap-2.5">
            <Layers className="h-4 w-4 text-cyan-400" />
            <SurfaceTitle>Module Boundary Reserved (Phase {spec.phase})</SurfaceTitle>
          </div>
          <SurfaceDescription>
            VisionX AI is built incrementally. Only Phase 1 Foundation modules are active in this stage.
          </SurfaceDescription>
        </SurfaceHeader>
        <SurfaceBody className="space-y-4">
          <p className="text-sm text-slate-300 leading-relaxed">{spec.summary}</p>
          <div className="rounded-md border border-slate-800 bg-[#070D1A] p-4 font-mono text-xs text-slate-400 space-y-1">
            <div>Route: {spec.path}</div>
            <div>Backend Adapter Target: {spec.backendBoundary}</div>
            <div>Operational Data: Not yet provisioned (zero fabricated results)</div>
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button asChild variant="secondary" size="sm">
              <Link to="/command-center">Return to Command Center</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin">Open Phase 1 Administration</Link>
            </Button>
          </div>
        </SurfaceBody>
      </Surface>
    </div>
  );
}
