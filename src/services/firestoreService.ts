import type { User } from 'firebase/auth';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, firebaseProjectInfo } from '@/src/services/firebase';
import { handleFirestoreError, OperationType } from '@/src/lib/firestoreError';
import { REFERENCE_ROLES } from '@/src/data/rbacReference';
import type {
  AuditLogRecord,
  InvitationRecord,
  OrganizationMemberRecord,
  OrganizationMembership,
  OrganizationRecord,
  SystemRoleKey,
  SystemSettingsRecord,
  UserProfile,
} from '@/src/types/foundation';

function generateSafeId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`.slice(0, 64);
}

function formatTimestamp(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function getRoleMeta(roleKey: SystemRoleKey) {
  return REFERENCE_ROLES.find((r) => r.key === roleKey) ?? REFERENCE_ROLES[REFERENCE_ROLES.length - 1];
}

const inFlightProfileSyncs = new Map<string, Promise<UserProfile>>();

export const firestoreService = {
  async syncUserProfiles(user: User): Promise<UserProfile> {
    const existingSync = inFlightProfileSyncs.get(user.uid);
    if (existingSync) {
      return existingSync;
    }

    const syncPromise = this._performSyncUserProfiles(user).finally(() => {
      inFlightProfileSyncs.delete(user.uid);
    });
    inFlightProfileSyncs.set(user.uid, syncPromise);
    return syncPromise;
  },

  async _performSyncUserProfiles(user: User): Promise<UserProfile> {
    const publicPath = `userProfilesPublic/${user.uid}`;
    const privatePath = `userProfilesPrivate/${user.uid}`;
    const displayName = (user.displayName || user.email?.split('@')[0] || 'VisionX Operator').slice(0, 120);
    const photoURL = (user.photoURL || '').slice(0, 500);
    const email = (user.email || '').slice(0, 255);

    let existingPublic: Record<string, unknown> | null = null;
    try {
      const snap = await getDoc(doc(db, 'userProfilesPublic', user.uid));
      if (snap.exists()) {
        existingPublic = snap.data();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, publicPath);
    }

    if (!existingPublic) {
      try {
        await setDoc(doc(db, 'userProfilesPublic', user.uid), {
          uid: user.uid,
          displayName,
          jobTitle: '',
          ...(photoURL ? { photoURL } : {}),
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, publicPath);
      }
    } else {
      try {
        await updateDoc(doc(db, 'userProfilesPublic', user.uid), {
          displayName: (existingPublic.displayName as string) || displayName,
          jobTitle: (existingPublic.jobTitle as string) || '',
          ...(photoURL ? { photoURL } : {}),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, publicPath);
      }
    }

    let existingPrivate: Record<string, unknown> | null = null;
    try {
      const privSnap = await getDoc(doc(db, 'userProfilesPrivate', user.uid));
      if (privSnap.exists()) {
        existingPrivate = privSnap.data();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, privatePath);
    }

    if (!existingPrivate) {
      try {
        await setDoc(doc(db, 'userProfilesPrivate', user.uid), {
          uid: user.uid,
          email,
          lastLoginAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, privatePath);
      }
    } else {
      try {
        await updateDoc(doc(db, 'userProfilesPrivate', user.uid), {
          email,
          lastLoginAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, privatePath);
      }
    }

    return {
      uid: user.uid,
      email,
      displayName: (existingPublic?.displayName as string) || displayName,
      jobTitle: (existingPublic?.jobTitle as string) || '',
      photoURL: photoURL || undefined,
      isActive: true,
      emailVerified: user.emailVerified,
    };
  },

  async updateOperatorProfile(
    uid: string,
    payload: { displayName: string; jobTitle: string }
  ): Promise<void> {
    const path = `userProfilesPublic/${uid}`;
    const cleanName = payload.displayName.trim().slice(0, 120);
    const cleanTitle = payload.jobTitle.trim().slice(0, 120);
    if (cleanName.length < 1) {
      throw new Error('Display name is required.');
    }

    try {
      await updateDoc(doc(db, 'userProfilesPublic', uid), {
        displayName: cleanName,
        jobTitle: cleanTitle,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  async fetchUserOrganizations(uid: string, email: string): Promise<{
    memberships: OrganizationMembership[];
    organizations: OrganizationRecord[];
  }> {
    const membershipsPath = 'collectionGroup/members';
    const isBootstrappedAdmin = firebaseProjectInfo.bootstrappedAdminEmails.includes(
      email.toLowerCase()
    );

    let memberDocs: Array<Record<string, unknown>> = [];
    try {
      const q = query(collectionGroup(db, 'members'), where('userId', '==', uid));
      const snap = await getDocs(q);
      memberDocs = snap.docs
        .map((d) => d.data())
        .filter((d) => d.status === 'active');
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, membershipsPath);
    }

    const orgsById = new Map<string, OrganizationRecord>();
    for (const m of memberDocs) {
      const orgId = String(m.orgId);
      const orgPath = `organizations/${orgId}`;
      try {
        const orgSnap = await getDoc(doc(db, 'organizations', orgId));
        if (orgSnap.exists()) {
          const data = orgSnap.data();
          orgsById.set(orgId, {
            id: String(data.id),
            name: String(data.name),
            slug: String(data.slug),
            industry: String(data.industry),
            status: String(data.status),
            ownerUid: String(data.ownerUid),
            createdAt: formatTimestamp(data.createdAt),
            updatedAt: formatTimestamp(data.updatedAt),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, orgPath);
      }
    }

    // Bootstrapped platform admin can also list all organizations
    if (isBootstrappedAdmin) {
      try {
        const allOrgsSnap = await getDocs(collection(db, 'organizations'));
        for (const d of allOrgsSnap.docs) {
          const data = d.data();
          if (!orgsById.has(d.id)) {
            orgsById.set(d.id, {
              id: String(data.id),
              name: String(data.name),
              slug: String(data.slug),
              industry: String(data.industry),
              status: String(data.status),
              ownerUid: String(data.ownerUid),
              createdAt: formatTimestamp(data.createdAt),
              updatedAt: formatTimestamp(data.updatedAt),
            });
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'organizations');
      }
    }

    const memberships: OrganizationMembership[] = [];
    for (const m of memberDocs) {
      const org = orgsById.get(String(m.orgId));
      if (!org) continue;
      const roleKey = m.roleKey as SystemRoleKey;
      const roleMeta = getRoleMeta(roleKey);
      memberships.push({
        organization_id: org.id,
        organization_name: org.name,
        organization_slug: org.slug,
        organization_industry: org.industry,
        organization_owner_uid: org.ownerUid,
        role_key: roleKey,
        role_name: roleMeta.name,
        hierarchy_level: roleMeta.hierarchy_level,
        permissions: [...roleMeta.permissions],
      });
    }

    // If bootstrapped platform admin views an org where they aren't explicitly listed in members/,
    // grant super_admin view context matching firestore.rules isPlatformAdmin().
    if (isBootstrappedAdmin) {
      const superRole = getRoleMeta('super_admin');
      for (const org of orgsById.values()) {
        if (!memberships.some((m) => m.organization_id === org.id)) {
          memberships.push({
            organization_id: org.id,
            organization_name: org.name,
            organization_slug: org.slug,
            organization_industry: org.industry,
            organization_owner_uid: org.ownerUid,
            role_key: 'super_admin',
            role_name: superRole.name,
            hierarchy_level: superRole.hierarchy_level,
            permissions: [...superRole.permissions],
          });
        }
      }
    }

    return {
      memberships,
      organizations: Array.from(orgsById.values()),
    };
  },

  async createOrganization(params: {
    uid: string;
    displayName: string;
    name: string;
    slug: string;
    industry: string;
  }): Promise<OrganizationRecord> {
    const cleanName = params.name.trim().slice(0, 120);
    const cleanSlug = params.slug.trim().toLowerCase().slice(0, 64);
    const cleanIndustry = params.industry.trim().slice(0, 120);
    const cleanDisplayName = params.displayName.trim().slice(0, 120) || 'Organization Owner';

    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(cleanSlug)) {
      throw new Error('Organization slug must match ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$.');
    }

    const orgId = generateSafeId('org');
    const logId = generateSafeId('log');
    const batch = writeBatch(db);

    batch.set(doc(db, 'organizations', orgId), {
      id: orgId,
      name: cleanName,
      slug: cleanSlug,
      industry: cleanIndustry,
      status: 'active',
      ownerUid: params.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', orgId, 'members', params.uid), {
      orgId,
      userId: params.uid,
      displayName: cleanDisplayName,
      roleKey: 'admin',
      status: 'active',
      invitedBy: params.uid,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', orgId, 'settings', 'default'), {
      orgId,
      sessionTimeoutMinutes: 480,
      requireMfaForPrivileged: false,
      retentionDays: 90,
      updatedBy: params.uid,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', orgId, 'auditLogs', logId), {
      id: logId,
      orgId,
      actorUid: params.uid,
      action: 'organization.created',
      resourceType: 'organization',
      resourceId: orgId,
      summary: `Created workspace ${cleanName} (${cleanSlug})`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `organizations/${orgId}`);
    }

    const now = new Date().toISOString();
    return {
      id: orgId,
      name: cleanName,
      slug: cleanSlug,
      industry: cleanIndustry,
      status: 'active',
      ownerUid: params.uid,
      createdAt: now,
      updatedAt: now,
    };
  },

  async listMembers(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<OrganizationMemberRecord[]> {
    const path = `organizations/${orgId}/members`;
    const isAdminEmail = firebaseProjectInfo.bootstrappedAdminEmails.includes(
      actorEmail.toLowerCase()
    );

    try {
      const baseRef = collection(db, 'organizations', orgId, 'members');
      const snap = isAdminEmail
        ? await getDocs(baseRef)
        : await getDocs(query(baseRef, where('userId', '==', actorUid)));

      return snap.docs.map((d) => {
        const data = d.data();
        const roleKey = data.roleKey as SystemRoleKey;
        return {
          orgId: String(data.orgId),
          userId: String(data.userId),
          displayName: String(data.displayName),
          roleKey,
          roleName: getRoleMeta(roleKey).name,
          status: (data.status as 'active' | 'suspended') || 'active',
          invitedBy: String(data.invitedBy),
          joinedAt: formatTimestamp(data.joinedAt),
        };
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  },

  async updateMemberRole(params: {
    orgId: string;
    targetUserId: string;
    actorUid: string;
    roleKey: SystemRoleKey;
  }): Promise<void> {
    const path = `organizations/${params.orgId}/members/${params.targetUserId}`;
    const logId = generateSafeId('log');
    const batch = writeBatch(db);

    batch.update(doc(db, 'organizations', params.orgId, 'members', params.targetUserId), {
      roleKey: params.roleKey,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'member.role_updated',
      resourceType: 'organization_member',
      resourceId: params.targetUserId,
      summary: `Assigned role ${params.roleKey} to member ${params.targetUserId}`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  async listInvitations(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<InvitationRecord[]> {
    const path = `organizations/${orgId}/invitations`;
    const isAdminEmail = firebaseProjectInfo.bootstrappedAdminEmails.includes(
      actorEmail.toLowerCase()
    );

    try {
      const baseRef = collection(db, 'organizations', orgId, 'invitations');
      const snap = isAdminEmail
        ? await getDocs(baseRef)
        : await getDocs(query(baseRef, where('invitedBy', '==', actorUid)));

      return snap.docs.map((d) => {
        const data = d.data();
        const roleKey = data.roleKey as SystemRoleKey;
        return {
          id: String(data.id),
          orgId: String(data.orgId),
          inviteeEmail: String(data.inviteeEmail),
          roleKey,
          roleName: getRoleMeta(roleKey).name,
          status: data.status as 'pending' | 'accepted' | 'revoked',
          invitedBy: String(data.invitedBy),
          createdAt: formatTimestamp(data.createdAt),
        };
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  },

  async listMyPendingInvitations(email: string): Promise<InvitationRecord[]> {
    const path = 'collectionGroup/invitations';
    try {
      const q = query(
        collectionGroup(db, 'invitations'),
        where('inviteeEmail', '==', email.toLowerCase())
      );
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => {
          const data = d.data();
          const roleKey = data.roleKey as SystemRoleKey;
          return {
            id: String(data.id),
            orgId: String(data.orgId),
            inviteeEmail: String(data.inviteeEmail),
            roleKey,
            roleName: getRoleMeta(roleKey).name,
            status: data.status as 'pending' | 'accepted' | 'revoked',
            invitedBy: String(data.invitedBy),
            createdAt: formatTimestamp(data.createdAt),
          };
        })
        .filter((inv) => inv.status === 'pending');
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  },

  async createInvitation(params: {
    orgId: string;
    actorUid: string;
    inviteeEmail: string;
    roleKey: 'admin' | 'security_analyst' | 'operator' | 'viewer';
  }): Promise<InvitationRecord> {
    const inviteId = generateSafeId('inv');
    const logId = generateSafeId('log');
    const cleanEmail = params.inviteeEmail.trim().toLowerCase().slice(0, 255);
    const batch = writeBatch(db);

    batch.set(doc(db, 'organizations', params.orgId, 'invitations', inviteId), {
      id: inviteId,
      orgId: params.orgId,
      inviteeEmail: cleanEmail,
      roleKey: params.roleKey,
      status: 'pending',
      invitedBy: params.actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'invitation.created',
      resourceType: 'organization_invitation',
      resourceId: inviteId,
      summary: `Invited ${cleanEmail} as ${params.roleKey}`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `organizations/${params.orgId}/invitations/${inviteId}`);
    }

    return {
      id: inviteId,
      orgId: params.orgId,
      inviteeEmail: cleanEmail,
      roleKey: params.roleKey,
      roleName: getRoleMeta(params.roleKey).name,
      status: 'pending',
      invitedBy: params.actorUid,
      createdAt: new Date().toISOString(),
    };
  },

  async acceptInvitation(params: {
    invitation: InvitationRecord;
    uid: string;
    displayName: string;
  }): Promise<void> {
    const { invitation, uid, displayName } = params;
    const logId = generateSafeId('log');
    const batch = writeBatch(db);

    batch.update(doc(db, 'organizations', invitation.orgId, 'invitations', invitation.id), {
      status: 'accepted',
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', invitation.orgId, 'members', uid), {
      orgId: invitation.orgId,
      userId: uid,
      displayName: displayName.trim().slice(0, 120) || 'Operator',
      roleKey: invitation.roleKey,
      status: 'active',
      invitedBy: invitation.invitedBy,
      invitationId: invitation.id,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', invitation.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: invitation.orgId,
      actorUid: uid,
      action: 'invitation.accepted',
      resourceType: 'organization_invitation',
      resourceId: invitation.id,
      summary: `${invitation.inviteeEmail} accepted invitation as ${invitation.roleKey}`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `organizations/${invitation.orgId}/invitations/${invitation.id}`
      );
    }
  },

  async revokeInvitation(params: {
    orgId: string;
    inviteId: string;
    actorUid: string;
  }): Promise<void> {
    const path = `organizations/${params.orgId}/invitations/${params.inviteId}`;
    const logId = generateSafeId('log');
    const batch = writeBatch(db);

    batch.update(doc(db, 'organizations', params.orgId, 'invitations', params.inviteId), {
      status: 'revoked',
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'invitation.revoked',
      resourceType: 'organization_invitation',
      resourceId: params.inviteId,
      summary: `Revoked invitation ${params.inviteId}`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  async getSettings(orgId: string): Promise<SystemSettingsRecord | null> {
    const path = `organizations/${orgId}/settings/default`;
    try {
      const snap = await getDoc(doc(db, 'organizations', orgId, 'settings', 'default'));
      if (!snap.exists()) return null;
      const data = snap.data();
      return {
        orgId: String(data.orgId),
        sessionTimeoutMinutes: Number(data.sessionTimeoutMinutes),
        requireMfaForPrivileged: Boolean(data.requireMfaForPrivileged),
        retentionDays: Number(data.retentionDays),
        updatedBy: String(data.updatedBy),
        updatedAt: formatTimestamp(data.updatedAt),
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    }
  },

  async updateSettings(params: {
    orgId: string;
    actorUid: string;
    sessionTimeoutMinutes: number;
    requireMfaForPrivileged: boolean;
    retentionDays: number;
  }): Promise<void> {
    const path = `organizations/${params.orgId}/settings/default`;
    const logId = generateSafeId('log');
    const batch = writeBatch(db);

    batch.update(doc(db, 'organizations', params.orgId, 'settings', 'default'), {
      sessionTimeoutMinutes: Math.min(10080, Math.max(15, Math.trunc(params.sessionTimeoutMinutes))),
      requireMfaForPrivileged: Boolean(params.requireMfaForPrivileged),
      retentionDays: Math.min(3650, Math.max(7, Math.trunc(params.retentionDays))),
      updatedBy: params.actorUid,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'settings.updated',
      resourceType: 'system_settings',
      resourceId: 'default',
      summary: `Updated session timeout (${params.sessionTimeoutMinutes}m) & retention (${params.retentionDays}d)`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  async listAuditLogs(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<AuditLogRecord[]> {
    const path = `organizations/${orgId}/auditLogs`;
    const isAdminEmail = firebaseProjectInfo.bootstrappedAdminEmails.includes(
      actorEmail.toLowerCase()
    );

    try {
      const baseRef = collection(db, 'organizations', orgId, 'auditLogs');
      const q = isAdminEmail
        ? query(baseRef, orderBy('createdAt', 'desc'))
        : query(baseRef, where('actorUid', '==', actorUid));
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: String(data.id),
            orgId: String(data.orgId),
            actorUid: String(data.actorUid),
            action: String(data.action),
            resourceType: String(data.resourceType),
            resourceId: String(data.resourceId),
            summary: String(data.summary),
            createdAt: formatTimestamp(data.createdAt),
          };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  },
};
