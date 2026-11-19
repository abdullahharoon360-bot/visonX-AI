import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/src/context/AuthContext';
import { Skeleton } from '@/src/components/ui/skeleton';
import { Surface, SurfaceBody } from '@/src/components/ui/surface';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredPermission?: string;
}

export function ProtectedRoute({ children, requiredPermission }: ProtectedRouteProps) {
  const { isLoading, isAuthenticated, isPreviewMode, hasPermission, activeOrganization } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#060B16] p-8">
        <div className="mx-auto max-w-4xl space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated && !isPreviewMode) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (
    requiredPermission &&
    isAuthenticated &&
    activeOrganization &&
    !hasPermission(requiredPermission)
  ) {
    return (
      <div className="p-8">
        <Surface className="mx-auto max-w-xl">
          <SurfaceBody className="flex items-start gap-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div className="space-y-1.5">
              <h2 className="font-display text-base font-semibold text-slate-100">
                Access Restricted
              </h2>
              <p className="text-sm text-slate-400">
                Your current role ({activeOrganization.role_name}) does not include the{' '}
                <span className="font-mono text-xs text-slate-200">{requiredPermission}</span>{' '}
                permission required for this workspace section.
              </p>
            </div>
          </SurfaceBody>
        </Surface>
      </div>
    );
  }

  return <>{children}</>;
}
