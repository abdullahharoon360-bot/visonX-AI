import { Link } from 'react-router-dom';
import { useAuth } from '@/src/context/AuthContext';
import { NoticeBanner } from '@/src/components/ui/notice-banner';
import { Button } from '@/src/components/ui/button';

export function useWorkspaceContext() {
  const { isAuthenticated, isPreviewMode, profile, activeOrganization, hasPermission } = useAuth();
  const orgId = activeOrganization?.organization_id ?? '';
  const orgOwnerUid = activeOrganization?.organization_owner_uid ?? '';
  const actorUid = profile?.uid ?? '';
  const actorEmail = profile?.email ?? '';
  const canQueryLive = isAuthenticated && !isPreviewMode && Boolean(orgId) && Boolean(actorUid);

  return {
    isAuthenticated,
    isPreviewMode,
    profile,
    activeOrganization,
    orgId,
    orgOwnerUid,
    actorUid,
    actorEmail,
    canQueryLive,
    hasPermission,
  };
}

export function WorkspaceGuardNotice() {
  const { isAuthenticated, isPreviewMode, activeOrganization } = useAuth();

  if (isPreviewMode || !isAuthenticated) {
    return (
      <NoticeBanner
        tone="warning"
        title="Read-Only Preview Mode"
        description="Sign in with Google and select an organization workspace to run live AI analysis and persist operational records to Cloud Firestore."
      />
    );
  }

  if (!activeOrganization) {
    return (
      <div className="space-y-3">
        <NoticeBanner
          tone="info"
          title="No Active Organization Workspace"
          description="Create your organization workspace (or accept a pending invitation) in Administration before registering cameras, identities, or incidents."
        />
        <div>
          <Button asChild size="sm" variant="secondary">
            <Link to="/admin">Open Administration</Link>
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
