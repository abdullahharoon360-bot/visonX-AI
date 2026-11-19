import * as React from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, googleProvider } from '@/src/services/firebase';
import { firestoreService } from '@/src/services/firestoreService';
import type {
  OrganizationMembership,
  OrganizationRecord,
  UserProfile,
} from '@/src/types/foundation';

interface AuthContextValue {
  isLoading: boolean;
  isAuthenticated: boolean;
  isPreviewMode: boolean;
  profile: UserProfile | null;
  memberships: OrganizationMembership[];
  organizations: OrganizationRecord[];
  activeOrganization: OrganizationMembership | null;
  syncError: string | null;
  setActiveOrganizationId: (orgId: string) => void;
  hasPermission: (permissionKey: string) => boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  enterPreviewMode: () => void;
  exitPreviewMode: () => void;
  refreshSessionProfile: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

const PREVIEW_STORAGE_KEY = 'visionx_architecture_preview';
const ACTIVE_ORG_STORAGE_KEY = 'visionx_active_org_id';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = React.useState(true);
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [isPreviewMode, setIsPreviewMode] = React.useState<boolean>(() => {
    try {
      return sessionStorage.getItem(PREVIEW_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [memberships, setMemberships] = React.useState<OrganizationMembership[]>([]);
  const [organizations, setOrganizations] = React.useState<OrganizationRecord[]>([]);
  const [activeOrgId, setActiveOrgIdState] = React.useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [syncError, setSyncError] = React.useState<string | null>(null);

  const activeOrgIdRef = React.useRef(activeOrgId);
  activeOrgIdRef.current = activeOrgId;

  const loadUserWorkspace = React.useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setIsAuthenticated(false);
      setProfile(null);
      setMemberships([]);
      setOrganizations([]);
      setSyncError(null);
      setIsLoading(false);
      return;
    }

    setIsAuthenticated(true);
    setIsPreviewMode(false);
    try {
      const syncedProfile = await firestoreService.syncUserProfiles(currentUser);
      setProfile(syncedProfile);

      const { memberships: userMemberships, organizations: userOrgs } =
        await firestoreService.fetchUserOrganizations(
          currentUser.uid,
          currentUser.email ?? ''
        );

      setMemberships(userMemberships);
      setOrganizations(userOrgs);
      setSyncError(null);

      if (userMemberships.length > 0) {
        const currentSelectedOrg = activeOrgIdRef.current;
        const storedMatches = userMemberships.some((m) => m.organization_id === currentSelectedOrg);
        if (!storedMatches) {
          const fallbackOrg = userMemberships[0].organization_id;
          setActiveOrgIdState(fallbackOrg);
          try {
            localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, fallbackOrg);
          } catch {
            // ignore storage errors
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to synchronize Firestore workspace.';
      setSyncError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, () => {
      void loadUserWorkspace();
    });
    return () => unsubscribe();
  }, [loadUserWorkspace]);

  const setActiveOrganizationId = React.useCallback((orgId: string) => {
    setActiveOrgIdState(orgId);
    try {
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
    } catch {
      // ignore storage errors
    }
  }, []);

  const activeOrganization = React.useMemo(() => {
    if (memberships.length === 0) return null;
    return memberships.find((m) => m.organization_id === activeOrgId) ?? memberships[0];
  }, [memberships, activeOrgId]);

  const hasPermission = React.useCallback(
    (permissionKey: string): boolean => {
      if (!activeOrganization) return false;
      return activeOrganization.permissions.includes(permissionKey);
    },
    [activeOrganization]
  );

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setIsAuthenticated(false);
    setProfile(null);
    setMemberships([]);
    setOrganizations([]);
    setIsPreviewMode(false);
    try {
      sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const enterPreviewMode = () => {
    setIsPreviewMode(true);
    try {
      sessionStorage.setItem(PREVIEW_STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
  };

  const exitPreviewMode = () => {
    setIsPreviewMode(false);
    try {
      sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <AuthContext.Provider
      value={{
        isLoading,
        isAuthenticated,
        isPreviewMode,
        profile,
        memberships,
        organizations,
        activeOrganization,
        syncError,
        setActiveOrganizationId,
        hasPermission,
        signInWithGoogle,
        signOut,
        enterPreviewMode,
        exitPreviewMode,
        refreshSessionProfile: loadUserWorkspace,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
