import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { useAuth } from '@/src/context/AuthContext';
import { firebaseProjectInfo, testFirestoreConnection } from '@/src/services/firebase';
import { firestoreService } from '@/src/services/firestoreService';
import { PLATFORM_MODULES } from '@/src/data/rbacReference';
import { Button } from '@/src/components/ui/button';
import { NoticeBanner } from '@/src/components/ui/notice-banner';
import { Skeleton } from '@/src/components/ui/skeleton';
import {
  Surface,
  SurfaceBody,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
} from '@/src/components/ui/surface';

export function CommandCenterPage() {
  const { isAuthenticated, isPreviewMode, activeOrganization, profile, syncError } = useAuth();

  const firestoreHealthQuery = useQuery({
    queryKey: ['firestore-connection'],
    queryFn: testFirestoreConnection,
    retry: false,
  });

  const pendingInvitesQuery = useQuery({
    queryKey: ['my-pending-invites', profile?.email],
    queryFn: () => firestoreService.listMyPendingInvitations(profile?.email ?? ''),
    enabled: isAuthenticated && Boolean(profile?.email),
  });

  const conn = firestoreHealthQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
            Security Command Center
          </h1>
          <p className="text-sm text-slate-400">
            Phase 1 Foundation · Firebase Google Authentication, Firestore Persistence, and RBAC
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void firestoreHealthQuery.refetch()}
          disabled={firestoreHealthQuery.isFetching}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${firestoreHealthQuery.isFetching ? 'animate-spin' : ''}`}
          />
          <span>Verify Firestore Connection</span>
        </Button>
      </div>

      {isPreviewMode && (
        <NoticeBanner
          tone="warning"
          title="Architecture Preview Mode Active"
          description="You are viewing the Phase 1 UI shell without signing in with Google. Operational metrics are intentionally omitted until Phase 2–6 backend pipelines are enabled."
        />
      )}

      {syncError && (
        <NoticeBanner
          tone="error"
          title="Firestore Workspace Sync Error"
          description={syncError}
        />
      )}

      {pendingInvitesQuery.data && pendingInvitesQuery.data.length > 0 && (
        <NoticeBanner
          tone="info"
          title={`You have ${pendingInvitesQuery.data.length} pending organization invitation(s)`}
          description="Open Administration -> Members & Invites to accept your workspace invitation."
        />
      )}

      {/* Phase 1 Foundation Status Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Surface>
          <SurfaceBody className="space-y-1.5">
            <p className="text-xs font-medium text-slate-400">Google Authentication</p>
            <p className="font-display text-lg font-semibold text-slate-100">
              {isAuthenticated ? 'Verified Session' : 'Not Signed In'}
            </p>
            <p className="font-mono text-xs text-slate-400 truncate">
              {isAuthenticated
                ? profile?.email
                : `Hint · ${firebaseProjectInfo.bootstrappedAdminEmail}`}
            </p>
          </SurfaceBody>
        </Surface>

        <Surface>
          <SurfaceBody className="space-y-1.5">
            <p className="text-xs font-medium text-slate-400">Firebase Project</p>
            <p className="font-display text-lg font-semibold text-slate-100 truncate">
              {firebaseProjectInfo.projectId}
            </p>
            <p className="font-mono text-xs text-slate-400 truncate">
              {firebaseProjectInfo.authDomain}
            </p>
          </SurfaceBody>
        </Surface>

        <Surface>
          <SurfaceBody className="space-y-1.5">
            <p className="text-xs font-medium text-slate-400">Cloud Firestore Database</p>
            {firestoreHealthQuery.isLoading ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <p className="font-display text-lg font-semibold text-slate-100">
                {conn?.reachable ? 'Online' : 'Offline'}
              </p>
            )}
            <p className="font-mono text-xs text-slate-400 truncate">
              {firebaseProjectInfo.databaseId}
            </p>
          </SurfaceBody>
        </Surface>

        <Surface>
          <SurfaceBody className="space-y-1.5">
            <p className="text-xs font-medium text-slate-400">Organization & Role Context</p>
            <p className="font-display text-lg font-semibold text-slate-100 truncate">
              {activeOrganization ? activeOrganization.organization_name : 'No Active Workspace'}
            </p>
            <p className="font-mono text-xs text-slate-400">
              {activeOrganization
                ? `${activeOrganization.role_name} · ${activeOrganization.permissions.length} perms`
                : 'Create or accept an invite in Admin'}
            </p>
          </SurfaceBody>
        </Surface>
      </div>

      {/* Honest Boundary Notice for Future Telemetry */}
      <NoticeBanner
        tone="info"
        title="Operational Telemetry Boundary (Phases 2–6)"
        description="Camera counts, live CV detections, biometric verification outcomes, and incident queues activate in Phases 2–6. Zero synthetic statistics are displayed."
      />

      {/* Platform Module Architecture Matrix */}
      <Surface>
        <SurfaceHeader>
          <SurfaceTitle>Platform Module Architecture & Implementation Status</SurfaceTitle>
          <SurfaceDescription>
            Modular routes across all 12 VisionX AI capabilities. Phase 1 Google authentication,
            Firestore persistence, organizations, and RBAC are active.
          </SurfaceDescription>
        </SurfaceHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                <th className="px-6 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">Phase</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Service Boundary</th>
                <th className="px-6 py-3 font-medium text-right">Route</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {PLATFORM_MODULES.map((mod) => (
                <tr key={mod.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-3.5">
                    <div className="font-medium text-slate-100">{mod.title}</div>
                    <div className="text-xs text-slate-400 max-w-xl">{mod.summary}</div>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-300 whitespace-nowrap">
                    Phase {mod.phase}
                  </td>
                  <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                    <span
                      className={
                        mod.status === 'implemented' ? 'text-emerald-400 font-medium' : 'text-slate-400'
                      }
                    >
                      {mod.status === 'implemented' ? 'Active (Phase 1)' : 'Planned Boundary'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-400 whitespace-nowrap">
                    {mod.backendBoundary}
                  </td>
                  <td className="px-6 py-3.5 text-right whitespace-nowrap">
                    <Link
                      to={mod.path}
                      className="inline-flex items-center gap-1 text-xs font-medium text-cyan-400 hover:text-cyan-300"
                    >
                      <span>Open</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Surface>
    </div>
  );
}
