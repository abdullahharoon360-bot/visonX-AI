-- ============================================================================
-- VisionX AI — Phase 1 Foundation Migration (Supabase PostgreSQL)
-- Normalized multi-tenant organization, user profile, RBAC, invitation,
-- audit logging, and system settings schema with strict Row Level Security.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Core Tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 120),
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
    industry TEXT NOT NULL DEFAULT 'Enterprise Security',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE CHECK (key IN ('super_admin', 'admin', 'security_analyst', 'operator', 'viewer')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    hierarchy_level INTEGER NOT NULL CHECK (hierarchy_level BETWEEN 1 AND 100),
    is_system BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    module TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL DEFAULT '',
    job_title TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    invited_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.organization_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    invited_by UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
    session_timeout_minutes INTEGER NOT NULL DEFAULT 480 CHECK (session_timeout_minutes BETWEEN 15 AND 10080),
    require_mfa_for_privileged BOOLEAN NOT NULL DEFAULT false,
    allowed_ip_cidrs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    retention_days INTEGER NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 7 AND 3650),
    updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. Indexes
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON public.organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_role_id ON public.organization_members(role_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_org_status ON public.organization_invitations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON public.organization_invitations(lower(email));
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON public.audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Updated-At Trigger & Auth User Sync
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON public.organizations;
CREATE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_org_members_updated_at ON public.organization_members;
CREATE TRIGGER trg_org_members_updated_at
    BEFORE UPDATE ON public.organization_members
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_system_settings_updated_at ON public.system_settings;
CREATE TRIGGER trg_system_settings_updated_at
    BEFORE UPDATE ON public.system_settings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Automatically provision user_profiles on Supabase Auth signup (never hardcode admin emails)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')
    )
    ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- 4. RBAC Helper Functions for Row Level Security
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_org_member(target_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.organization_id = target_org_id
          AND om.user_id = auth.uid()
          AND om.status = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION public.has_org_permission(target_org_id UUID, perm_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.role_permissions rp ON rp.role_id = om.role_id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE om.organization_id = target_org_id
          AND om.user_id = auth.uid()
          AND om.status = 'active'
          AND p.key = perm_key
    );
$$;

-- ----------------------------------------------------------------------------
-- 5. Row Level Security (RLS) Policies
-- ----------------------------------------------------------------------------

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Roles & Permissions catalog: readable by any authenticated user, mutable only by service role
CREATE POLICY "roles_read_authenticated" ON public.roles
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "permissions_read_authenticated" ON public.permissions
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "role_permissions_read_authenticated" ON public.role_permissions
    FOR SELECT TO authenticated USING (true);

-- User Profiles: users can read their own profile or co-members' profiles, update only their own
CREATE POLICY "profiles_select_self_or_comember" ON public.user_profiles
    FOR SELECT TO authenticated
    USING (
        id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM public.organization_members me
            JOIN public.organization_members peer
              ON peer.organization_id = me.organization_id
            WHERE me.user_id = auth.uid()
              AND me.status = 'active'
              AND peer.user_id = user_profiles.id
        )
    );

CREATE POLICY "profiles_update_self" ON public.user_profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Organizations: visible only to active members; updates require org:update
CREATE POLICY "orgs_select_member" ON public.organizations
    FOR SELECT TO authenticated
    USING (public.is_org_member(id));

CREATE POLICY "orgs_insert_authenticated" ON public.organizations
    FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "orgs_update_authorized" ON public.organizations
    FOR UPDATE TO authenticated
    USING (public.has_org_permission(id, 'org:update'))
    WITH CHECK (public.has_org_permission(id, 'org:update'));

-- Organization Members: isolated per organization
CREATE POLICY "org_members_select_member" ON public.organization_members
    FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE POLICY "org_members_manage_authorized" ON public.organization_members
    FOR ALL TO authenticated
    USING (public.has_org_permission(organization_id, 'members:manage'))
    WITH CHECK (public.has_org_permission(organization_id, 'members:manage'));

-- Invitations: isolated per organization
CREATE POLICY "org_invites_select_authorized" ON public.organization_invitations
    FOR SELECT TO authenticated
    USING (public.has_org_permission(organization_id, 'members:read'));

CREATE POLICY "org_invites_manage_authorized" ON public.organization_invitations
    FOR ALL TO authenticated
    USING (public.has_org_permission(organization_id, 'members:invite'))
    WITH CHECK (public.has_org_permission(organization_id, 'members:invite'));

-- Audit Logs: append via backend service or authorized actors, read requires audit:read
CREATE POLICY "audit_logs_select_authorized" ON public.audit_logs
    FOR SELECT TO authenticated
    USING (
        organization_id IS NOT NULL
        AND public.has_org_permission(organization_id, 'audit:read')
    );

-- System Settings: isolated per organization
CREATE POLICY "system_settings_select_authorized" ON public.system_settings
    FOR SELECT TO authenticated
    USING (public.has_org_permission(organization_id, 'settings:read'));

CREATE POLICY "system_settings_update_authorized" ON public.system_settings
    FOR UPDATE TO authenticated
    USING (public.has_org_permission(organization_id, 'settings:update'))
    WITH CHECK (public.has_org_permission(organization_id, 'settings:update'));

-- ----------------------------------------------------------------------------
-- 6. Seed System Roles & Phase 1 Permissions
-- ----------------------------------------------------------------------------

INSERT INTO public.roles (key, name, description, hierarchy_level, is_system)
VALUES
    ('super_admin', 'Super Admin', 'Full platform governance, security policy, and cross-module administration.', 100, true),
    ('admin', 'Administrator', 'Organization management, member invitations, RBAC assignment, and system configuration.', 80, true),
    ('security_analyst', 'Security Analyst', 'Investigations, incident triage, AI Security Analyst, evidence review, and analytics.', 60, true),
    ('operator', 'Operator', 'Live monitoring, camera checks, checkpoint verification initiation, and incident reporting.', 40, true),
    ('viewer', 'Viewer', 'Read-only access to authorized dashboards and published reports.', 20, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.permissions (key, module, description)
VALUES
    ('org:read', 'administration', 'View organization metadata and workspace summary'),
    ('org:update', 'administration', 'Modify organization profile and workspace settings'),
    ('members:read', 'administration', 'View organization members and pending invitations'),
    ('members:invite', 'administration', 'Invite new users to the organization'),
    ('members:manage', 'administration', 'Modify member roles or suspend organization access'),
    ('roles:read', 'administration', 'Inspect role definitions and permission matrix'),
    ('audit:read', 'administration', 'Query organization audit log trail'),
    ('settings:read', 'administration', 'View organization security and retention settings'),
    ('settings:update', 'administration', 'Update session timeouts, MFA policies, and retention settings'),
    ('command_center:read', 'command_center', 'Access the Security Command Center overview'),
    ('cameras:read', 'cameras', 'View registered cameras and health status (Phase 3)'),
    ('cameras:manage', 'cameras', 'Register, edit, and test camera endpoints (Phase 3)'),
    ('vision:read', 'vision', 'View live vision detections and video intelligence jobs (Phase 4)'),
    ('identity:verify', 'identity', 'Initiate multimodal biometric verification sessions (Phase 5)'),
    ('identity:enroll', 'identity', 'Enroll and manage biometric identity records (Phase 5)'),
    ('incidents:read', 'incidents', 'View security events, risk assessments, and incidents (Phase 6)'),
    ('incidents:manage', 'incidents', 'Triage, assign, and resolve security incidents (Phase 6)'),
    ('analyst:query', 'ai_analyst', 'Query the AI Security Analyst over authorized evidence (Phase 7)'),
    ('evidence:read', 'investigation', 'Access digital evidence records and chain-of-custody logs (Phase 8)'),
    ('reports:export', 'reports', 'Generate and export security and research reports (Phase 8)')
ON CONFLICT (key) DO NOTHING;

-- Map Role -> Permissions
WITH role_map (role_key, perm_key) AS (
    VALUES
        -- Super Admin gets all permissions
        ('super_admin', 'org:read'), ('super_admin', 'org:update'),
        ('super_admin', 'members:read'), ('super_admin', 'members:invite'), ('super_admin', 'members:manage'),
        ('super_admin', 'roles:read'), ('super_admin', 'audit:read'),
        ('super_admin', 'settings:read'), ('super_admin', 'settings:update'),
        ('super_admin', 'command_center:read'), ('super_admin', 'cameras:read'), ('super_admin', 'cameras:manage'),
        ('super_admin', 'vision:read'), ('super_admin', 'identity:verify'), ('super_admin', 'identity:enroll'),
        ('super_admin', 'incidents:read'), ('super_admin', 'incidents:manage'),
        ('super_admin', 'analyst:query'), ('super_admin', 'evidence:read'), ('super_admin', 'reports:export'),

        -- Administrator
        ('admin', 'org:read'), ('admin', 'org:update'),
        ('admin', 'members:read'), ('admin', 'members:invite'), ('admin', 'members:manage'),
        ('admin', 'roles:read'), ('admin', 'audit:read'),
        ('admin', 'settings:read'), ('admin', 'settings:update'),
        ('admin', 'command_center:read'), ('admin', 'cameras:read'), ('admin', 'cameras:manage'),
        ('admin', 'vision:read'), ('admin', 'incidents:read'), ('admin', 'reports:export'),

        -- Security Analyst
        ('security_analyst', 'org:read'), ('security_analyst', 'members:read'), ('security_analyst', 'roles:read'),
        ('security_analyst', 'audit:read'), ('security_analyst', 'command_center:read'),
        ('security_analyst', 'cameras:read'), ('security_analyst', 'vision:read'),
        ('security_analyst', 'incidents:read'), ('security_analyst', 'incidents:manage'),
        ('security_analyst', 'analyst:query'), ('security_analyst', 'evidence:read'), ('security_analyst', 'reports:export'),

        -- Operator
        ('operator', 'org:read'), ('operator', 'roles:read'), ('operator', 'command_center:read'),
        ('operator', 'cameras:read'), ('operator', 'vision:read'),
        ('operator', 'identity:verify'), ('operator', 'incidents:read'),

        -- Viewer
        ('viewer', 'org:read'), ('viewer', 'roles:read'), ('viewer', 'command_center:read'),
        ('viewer', 'cameras:read'), ('viewer', 'incidents:read')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM role_map rm
JOIN public.roles r ON r.key = rm.role_key
JOIN public.permissions p ON p.key = rm.perm_key
ON CONFLICT DO NOTHING;
