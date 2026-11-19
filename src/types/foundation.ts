export type SystemRoleKey =
  | 'super_admin'
  | 'admin'
  | 'security_analyst'
  | 'operator'
  | 'viewer';

export interface RoleDefinition {
  id: string;
  key: SystemRoleKey;
  name: string;
  description: string;
  hierarchy_level: number;
  is_system: boolean;
  permissions: string[];
}

export interface PermissionDefinition {
  id: string;
  key: string;
  module: string;
  description: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  jobTitle: string;
  photoURL?: string;
  isActive: boolean;
  emailVerified: boolean;
  createdAt?: string;
}

export interface OrganizationMembership {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  organization_industry: string;
  organization_owner_uid: string;
  role_key: SystemRoleKey;
  role_name: string;
  hierarchy_level: number;
  permissions: string[];
}

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  industry: string;
  status: string;
  ownerUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMemberRecord {
  orgId: string;
  userId: string;
  displayName: string;
  roleKey: SystemRoleKey;
  roleName: string;
  status: 'active' | 'suspended';
  invitedBy: string;
  joinedAt: string;
}

export interface InvitationRecord {
  id: string;
  orgId: string;
  inviteeEmail: string;
  roleKey: SystemRoleKey;
  roleName: string;
  status: 'pending' | 'accepted' | 'revoked';
  invitedBy: string;
  createdAt: string;
}

export interface SystemSettingsRecord {
  orgId: string;
  sessionTimeoutMinutes: number;
  requireMfaForPrivileged: boolean;
  retentionDays: number;
  updatedBy: string;
  updatedAt: string;
}

export interface AuditLogRecord {
  id: string;
  orgId: string;
  actorUid: string;
  action: string;
  resourceType: string;
  resourceId: string;
  summary: string;
  createdAt: string;
}
