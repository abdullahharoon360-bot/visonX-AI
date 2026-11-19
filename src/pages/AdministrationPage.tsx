import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Check, MailPlus, Plus } from 'lucide-react';
import { useAuth } from '@/src/context/AuthContext';
import { firestoreService } from '@/src/services/firestoreService';
import { REFERENCE_PERMISSIONS, REFERENCE_ROLES } from '@/src/data/rbacReference';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Modal, ModalPanel, ModalTrigger } from '@/src/components/ui/modal';
import { NoticeBanner } from '@/src/components/ui/notice-banner';
import { SegmentedTabs } from '@/src/components/ui/segmented-tabs';
import { SelectField } from '@/src/components/ui/select-field';
import { Skeleton } from '@/src/components/ui/skeleton';
import {
  Surface,
  SurfaceBody,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
} from '@/src/components/ui/surface';
import type { InvitationRecord, SystemRoleKey } from '@/src/types/foundation';

type AdminTab = 'organizations' | 'members' | 'rbac' | 'settings' | 'audit';

const createOrgSchema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters.').max(120),
  slug: z
    .string()
    .min(3, 'Slug must be at least 3 characters.')
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'Use lowercase letters, numbers, and hyphens only.'),
  industry: z.string().min(2, 'Specify an industry sector.').max(120),
});

const inviteSchema = z.object({
  email: z.string().email('Enter a valid invitee email.').max(255),
  role_key: z.enum(['admin', 'security_analyst', 'operator', 'viewer']),
});

const settingsSchema = z.object({
  sessionTimeoutMinutes: z.number().int().min(15).max(10080),
  retentionDays: z.number().int().min(7).max(3650),
  requireMfaForPrivileged: z.boolean(),
});

export function AdministrationPage() {
  const {
    isAuthenticated,
    isPreviewMode,
    profile,
    organizations,
    activeOrganization,
    hasPermission,
    refreshSessionProfile,
  } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState<AdminTab>('organizations');
  const [orgModalOpen, setOrgModalOpen] = React.useState(false);
  const [inviteModalOpen, setInviteModalOpen] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{
    tone: 'success' | 'error';
    title: string;
    detail?: string;
  } | null>(null);

  const orgId = activeOrganization?.organization_id ?? '';
  const liveEnabled = isAuthenticated && !isPreviewMode && Boolean(profile);

  const membersQuery = useQuery({
    queryKey: ['fs-members', orgId, profile?.uid],
    queryFn: () =>
      firestoreService.listMembers(orgId, profile!.uid, profile!.email),
    enabled: liveEnabled && Boolean(orgId) && hasPermission('members:read'),
  });

  const invitationsQuery = useQuery({
    queryKey: ['fs-invitations', orgId, profile?.uid],
    queryFn: () =>
      firestoreService.listInvitations(orgId, profile!.uid, profile!.email),
    enabled: liveEnabled && Boolean(orgId) && hasPermission('members:read'),
  });

  const myInvitesQuery = useQuery({
    queryKey: ['my-pending-invites', profile?.email],
    queryFn: () => firestoreService.listMyPendingInvitations(profile!.email),
    enabled: liveEnabled && Boolean(profile?.email),
  });

  const settingsQuery = useQuery({
    queryKey: ['fs-settings', orgId],
    queryFn: () => firestoreService.getSettings(orgId),
    enabled: liveEnabled && Boolean(orgId) && hasPermission('settings:read'),
  });

  const auditQuery = useQuery({
    queryKey: ['fs-audit-logs', orgId, profile?.uid],
    queryFn: () =>
      firestoreService.listAuditLogs(orgId, profile!.uid, profile!.email),
    enabled: liveEnabled && Boolean(orgId) && hasPermission('audit:read'),
  });

  const orgForm = useForm<z.infer<typeof createOrgSchema>>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: { name: '', slug: '', industry: 'Enterprise Security' },
  });

  const inviteForm = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role_key: 'operator' },
  });

  const settingsForm = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    values: settingsQuery.data
      ? {
          sessionTimeoutMinutes: settingsQuery.data.sessionTimeoutMinutes,
          retentionDays: settingsQuery.data.retentionDays,
          requireMfaForPrivileged: settingsQuery.data.requireMfaForPrivileged,
        }
      : {
          sessionTimeoutMinutes: 480,
          retentionDays: 90,
          requireMfaForPrivileged: false,
        },
  });

  const createOrgMutation = useMutation({
    mutationFn: (values: z.infer<typeof createOrgSchema>) =>
      firestoreService.createOrganization({
        uid: profile!.uid,
        displayName: profile!.displayName,
        ...values,
      }),
    onSuccess: async () => {
      setOrgModalOpen(false);
      orgForm.reset();
      await refreshSessionProfile();
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs'] });
      setFeedback({ tone: 'success', title: 'Organization Created in Firestore' });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Unable to Create Organization',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: (values: z.infer<typeof inviteSchema>) =>
      firestoreService.createInvitation({
        orgId,
        actorUid: profile!.uid,
        inviteeEmail: values.email,
        roleKey: values.role_key,
      }),
    onSuccess: async (res) => {
      setInviteModalOpen(false);
      inviteForm.reset();
      await queryClient.invalidateQueries({ queryKey: ['fs-invitations', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs', orgId] });
      setFeedback({
        tone: 'success',
        title: `Invitation created for ${res.inviteeEmail}`,
        detail: 'The invitee can accept this workspace invitation upon signing in with Google.',
      });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Invitation Failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const acceptInviteMutation = useMutation({
    mutationFn: (invitation: InvitationRecord) =>
      firestoreService.acceptInvitation({
        invitation,
        uid: profile!.uid,
        displayName: profile!.displayName,
      }),
    onSuccess: async () => {
      await refreshSessionProfile();
      await queryClient.invalidateQueries({ queryKey: ['my-pending-invites'] });
      setFeedback({ tone: 'success', title: 'Invitation Accepted' });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Unable to Accept Invitation',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) =>
      firestoreService.revokeInvitation({ orgId, inviteId, actorUid: profile!.uid }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fs-invitations', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs', orgId] });
      setFeedback({ tone: 'success', title: 'Invitation Revoked' });
    },
  });

  const updateMemberRoleMutation = useMutation({
    mutationFn: ({ targetUserId, roleKey }: { targetUserId: string; roleKey: SystemRoleKey }) =>
      firestoreService.updateMemberRole({
        orgId,
        targetUserId,
        actorUid: profile!.uid,
        roleKey,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fs-members', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs', orgId] });
      setFeedback({ tone: 'success', title: 'Member Role Updated' });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Role Update Rejected',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (values: z.infer<typeof settingsSchema>) =>
      firestoreService.updateSettings({
        orgId,
        actorUid: profile!.uid,
        ...values,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fs-settings', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs', orgId] });
      setFeedback({ tone: 'success', title: 'Security Settings Saved to Firestore' });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Settings Update Rejected',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
            Administration & Governance
          </h1>
          <p className="text-sm text-slate-400">
            Firestore Organizations · Role-Based Access Control · Security Policies · Audit Trail
          </p>
        </div>

        <SegmentedTabs<AdminTab>
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { id: 'organizations', label: 'Organizations' },
            { id: 'members', label: 'Members & Invites' },
            { id: 'rbac', label: 'RBAC Matrix' },
            { id: 'settings', label: 'Security Settings' },
            { id: 'audit', label: 'Audit Logs' },
          ]}
        />
      </div>

      {isPreviewMode && (
        <NoticeBanner
          tone="warning"
          title="Read-Only Preview Boundary"
          description="Sign in with Google to create organizations, invite members, update settings, and write audit logs to Cloud Firestore."
        />
      )}

      {feedback && (
        <NoticeBanner tone={feedback.tone} title={feedback.title} description={feedback.detail} />
      )}

      {/* TAB 1: Organizations */}
      {activeTab === 'organizations' && (
        <Surface>
          <SurfaceHeader className="flex-row items-center justify-between">
            <div>
              <SurfaceTitle>Organizations</SurfaceTitle>
              <SurfaceDescription>
                Multi-tenant isolation enforced via Firestore security rules (Master Gate).
              </SurfaceDescription>
            </div>

            <Modal open={orgModalOpen} onOpenChange={setOrgModalOpen}>
              <ModalTrigger asChild>
                <Button size="sm" disabled={!liveEnabled}>
                  <Plus className="h-4 w-4" />
                  <span>New Organization</span>
                </Button>
              </ModalTrigger>
              <ModalPanel
                title="Create Organization Workspace"
                description="Atomically provisions an organization, initial admin membership, default security policy, and audit entry."
              >
                <form
                  onSubmit={orgForm.handleSubmit((v) => createOrgMutation.mutate(v))}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="org-name">Organization Name</Label>
                    <Input id="org-name" placeholder="VisionX Security Operations" {...orgForm.register('name')} />
                    {orgForm.formState.errors.name && (
                      <p className="text-xs text-red-400">{orgForm.formState.errors.name.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-slug">Workspace Slug</Label>
                    <Input id="org-slug" placeholder="visionx-sec-ops" {...orgForm.register('slug')} />
                    {orgForm.formState.errors.slug && (
                      <p className="text-xs text-red-400">{orgForm.formState.errors.slug.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-industry">Industry Sector</Label>
                    <Input id="org-industry" {...orgForm.register('industry')} />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="ghost" onClick={() => setOrgModalOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createOrgMutation.isPending}>
                      {createOrgMutation.isPending ? 'Creating...' : 'Create Organization'}
                    </Button>
                  </div>
                </form>
              </ModalPanel>
            </Modal>
          </SurfaceHeader>

          <SurfaceBody>
            {!liveEnabled ? (
              <div className="py-10 text-center space-y-2">
                <Building2 className="mx-auto h-7 w-7 text-slate-500" />
                <p className="text-sm font-medium text-slate-200">
                  No Active Organization Data in Preview Mode
                </p>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Sign in with Google to create organizations and manage RBAC memberships in Firestore.
                </p>
              </div>
            ) : organizations.length === 0 ? (
              <div className="py-10 text-center space-y-3">
                <p className="text-sm font-medium text-slate-200">No Organizations Found</p>
                <p className="text-xs text-slate-400">
                  Create your first organization workspace to initialize members, policies, and audit trails.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/70">
                {organizations.map((org) => (
                  <div key={org.id} className="flex flex-wrap items-center justify-between gap-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-slate-100">{org.name}</p>
                      <p className="font-mono text-xs text-slate-400">
                        {org.slug} · {org.industry} · {org.status}
                      </p>
                    </div>
                    <span className="font-mono text-xs text-slate-500">{org.id}</span>
                  </div>
                ))}
              </div>
            )}
          </SurfaceBody>
        </Surface>
      )}

      {/* TAB 2: Members & Invitations */}
      {activeTab === 'members' && (
        <Surface>
          <SurfaceHeader className="flex-row items-center justify-between">
            <div>
              <SurfaceTitle>Members & Invitations</SurfaceTitle>
              <SurfaceDescription>
                Manage workspace operators, role assignments, and email-scoped Google invitations.
              </SurfaceDescription>
            </div>

            <Modal open={inviteModalOpen} onOpenChange={setInviteModalOpen}>
              <ModalTrigger asChild>
                <Button size="sm" disabled={!liveEnabled || !orgId || !hasPermission('members:invite')}>
                  <MailPlus className="h-4 w-4" />
                  <span>Invite Member</span>
                </Button>
              </ModalTrigger>
              <ModalPanel
                title="Invite Organization Member"
                description="Creates an email-matched invitation document in Firestore."
              >
                <form
                  onSubmit={inviteForm.handleSubmit((v) => inviteMutation.mutate(v))}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Invitee Google Email</Label>
                    <Input id="invite-email" type="email" placeholder="analyst@gmail.com" {...inviteForm.register('email')} />
                    {inviteForm.formState.errors.email && (
                      <p className="text-xs text-red-400">{inviteForm.formState.errors.email.message}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-role">Assigned Role</Label>
                    <SelectField
                      id="invite-role"
                      {...inviteForm.register('role_key')}
                      options={[
                        { value: 'viewer', label: 'Viewer (Read-Only)' },
                        { value: 'operator', label: 'Operator' },
                        { value: 'security_analyst', label: 'Security Analyst' },
                        { value: 'admin', label: 'Administrator' },
                      ]}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="ghost" onClick={() => setInviteModalOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={inviteMutation.isPending}>
                      {inviteMutation.isPending ? 'Creating Invite...' : 'Send Invitation'}
                    </Button>
                  </div>
                </form>
              </ModalPanel>
            </Modal>
          </SurfaceHeader>

          <SurfaceBody className="space-y-6">
            {myInvitesQuery.data && myInvitesQuery.data.length > 0 && (
              <div className="rounded-md border border-cyan-500/30 bg-cyan-950/15 p-4 space-y-3">
                <p className="text-xs font-medium text-cyan-200">
                  Invitations Addressed to Your Account ({profile?.email})
                </p>
                {myInvitesQuery.data.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-slate-200 font-mono">
                      Org {inv.orgId} · Role: {inv.roleName}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => acceptInviteMutation.mutate(inv)}
                      disabled={acceptInviteMutation.isPending}
                    >
                      Accept Invitation
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {!liveEnabled || !orgId ? (
              <p className="py-8 text-center text-sm text-slate-400">
                Sign in with Google and select an organization to inspect members and invitations.
              </p>
            ) : membersQuery.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : membersQuery.isError ? (
              <NoticeBanner
                tone="error"
                title="Unable to Load Members"
                description={membersQuery.error instanceof Error ? membersQuery.error.message : undefined}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                      <th className="py-2.5 pr-4 font-medium">Member</th>
                      <th className="py-2.5 px-4 font-medium">Role</th>
                      <th className="py-2.5 px-4 font-medium">Status</th>
                      <th className="py-2.5 pl-4 font-medium text-right">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {(membersQuery.data ?? []).map((member) => (
                      <tr key={member.userId}>
                        <td className="py-3 pr-4">
                          <div className="font-medium text-slate-100">{member.displayName}</div>
                          <div className="font-mono text-xs text-slate-400">{member.userId}</div>
                        </td>
                        <td className="py-3 px-4">
                          {hasPermission('members:manage') ? (
                            <select
                              aria-label={`Role for ${member.displayName}`}
                              value={member.roleKey}
                              onChange={(e) =>
                                updateMemberRoleMutation.mutate({
                                  targetUserId: member.userId,
                                  roleKey: e.target.value as SystemRoleKey,
                                })
                              }
                              className="h-8 rounded border border-slate-800 bg-[#070D1A] px-2 text-xs text-slate-200"
                            >
                              {REFERENCE_ROLES.map((r) => (
                                <option key={r.key} value={r.key}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-slate-300">{member.roleName}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-300">{member.status}</td>
                        <td className="py-3 pl-4 text-right font-mono text-xs text-slate-400">
                          {new Date(member.joinedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {invitationsQuery.data && invitationsQuery.data.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-slate-800/80">
                <h3 className="text-xs font-medium text-slate-300">Organization Invitations</h3>
                <div className="divide-y divide-slate-800/60">
                  {invitationsQuery.data.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between gap-4 py-2.5 text-xs">
                      <span className="text-slate-200">
                        {inv.inviteeEmail} · {inv.roleName} · {inv.status}
                      </span>
                      {inv.status === 'pending' && hasPermission('members:invite') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => revokeInviteMutation.mutate(inv.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SurfaceBody>
        </Surface>
      )}

      {/* TAB 3: RBAC Matrix */}
      {activeTab === 'rbac' && (
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Role-Based Access Control Matrix</SurfaceTitle>
            <SurfaceDescription>
              Five hierarchical roles enforced across Firestore rules and client workspace boundaries.
            </SurfaceDescription>
          </SurfaceHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-slate-400">
                  <th className="px-6 py-3 font-medium">Permission</th>
                  {REFERENCE_ROLES.map((role) => (
                    <th key={role.key} className="px-3 py-3 text-center font-medium whitespace-nowrap">
                      <div>{role.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        L{role.hierarchy_level}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {REFERENCE_PERMISSIONS.map((perm) => (
                  <tr key={perm.key} className="hover:bg-slate-800/25">
                    <td className="px-6 py-2.5">
                      <div className="font-mono text-slate-200">{perm.key}</div>
                      <div className="text-slate-400">{perm.description}</div>
                    </td>
                    {REFERENCE_ROLES.map((role) => {
                      const granted = role.permissions.includes(perm.key);
                      return (
                        <td key={role.key} className="px-3 py-2.5 text-center">
                          {granted ? (
                            <Check className="mx-auto h-4 w-4 text-cyan-400" aria-label="Granted" />
                          ) : (
                            <span className="text-slate-600" aria-label="Not granted">
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* TAB 4: Security Settings */}
      {activeTab === 'settings' && (
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Organization Security & Retention Policies</SurfaceTitle>
            <SurfaceDescription>
              Persisted in Firestore at /organizations/{'{orgId}'}/settings/default with strict range checks.
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody>
            {!liveEnabled || !orgId ? (
              <p className="py-8 text-center text-sm text-slate-400">
                Sign in with an organization having settings:read permission to inspect or update policy parameters.
              </p>
            ) : (
              <form
                onSubmit={settingsForm.handleSubmit((v) => updateSettingsMutation.mutate(v))}
                className="max-w-lg space-y-5"
              >
                <div className="space-y-2">
                  <Label htmlFor="session-timeout">Session Timeout (Minutes, 15–10080)</Label>
                  <Input
                    id="session-timeout"
                    type="number"
                    {...settingsForm.register('sessionTimeoutMinutes', { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="retention-days">Audit & Telemetry Retention (Days, 7–3650)</Label>
                  <Input
                    id="retention-days"
                    type="number"
                    {...settingsForm.register('retentionDays', { valueAsNumber: true })}
                  />
                </div>
                <label className="flex items-center gap-3 text-sm text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-700 bg-[#070D1A]"
                    {...settingsForm.register('requireMfaForPrivileged')}
                  />
                  <span>Require MFA for Super Admin and Administrator roles</span>
                </label>
                <Button
                  type="submit"
                  disabled={!hasPermission('settings:update') || updateSettingsMutation.isPending}
                >
                  {updateSettingsMutation.isPending ? 'Saving...' : 'Save Security Settings'}
                </Button>
              </form>
            )}
          </SurfaceBody>
        </Surface>
      )}

      {/* TAB 5: Audit Logs */}
      {activeTab === 'audit' && (
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Security Audit Log</SurfaceTitle>
            <SurfaceDescription>
              Immutable append-only Firestore trail (updates and deletes denied by security rules).
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody>
            {!liveEnabled || !orgId ? (
              <p className="py-8 text-center text-sm text-slate-400">
                Sign in with an organization having audit:read permission to query the audit trail.
              </p>
            ) : auditQuery.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : !auditQuery.data || auditQuery.data.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                No audit events recorded for this organization yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-slate-400">
                      <th className="py-2.5 pr-4 font-medium">Timestamp</th>
                      <th className="py-2.5 px-4 font-medium">Action</th>
                      <th className="py-2.5 px-4 font-medium">Summary</th>
                      <th className="py-2.5 pl-4 font-medium">Actor UID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {auditQuery.data.map((entry) => (
                      <tr key={entry.id}>
                        <td className="py-2.5 pr-4 text-slate-400 whitespace-nowrap">
                          {entry.createdAt}
                        </td>
                        <td className="py-2.5 px-4 text-cyan-300">{entry.action}</td>
                        <td className="py-2.5 px-4 font-sans text-slate-200">{entry.summary}</td>
                        <td className="py-2.5 pl-4 text-slate-400">{entry.actorUid.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceBody>
        </Surface>
      )}
    </div>
  );
}
