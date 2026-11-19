import * as React from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bot,
  Camera,
  ChevronRight,
  FileBarChart2,
  Fingerprint,
  FlaskConical,
  FolderSearch,
  LayoutDashboard,
  LogOut,
  Menu,
  Radar,
  Settings2,
  Shield,
  ShieldAlert,
  UserCircle2,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useAuth } from '@/src/context/AuthContext';
import { PLATFORM_MODULES } from '@/src/data/rbacReference';
import { Button } from '@/src/components/ui/button';

const iconByModuleId: Record<string, React.ComponentType<{ className?: string }>> = {
  'command-center': LayoutDashboard,
  'live-monitoring': Activity,
  cameras: Camera,
  'video-intelligence': Video,
  identity: Fingerprint,
  incidents: ShieldAlert,
  'threat-intelligence': Radar,
  'ai-analyst': Bot,
  investigations: FolderSearch,
  'research-lab': FlaskConical,
  reports: FileBarChart2,
  admin: Settings2,
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    isAuthenticated,
    isPreviewMode,
    profile,
    memberships,
    activeOrganization,
    setActiveOrganizationId,
    signOut,
    exitPreviewMode,
  } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const activeModule = React.useMemo(() => {
    if (location.pathname === '/profile') {
      return { title: 'User Profile & Security' };
    }
    return (
      PLATFORM_MODULES.find((m) => location.pathname.startsWith(m.path)) ?? {
        title: 'Workspace',
      }
    );
  }, [location.pathname]);

  const handleSignOut = async () => {
    if (isPreviewMode) {
      exitPreviewMode();
      navigate('/login');
      return;
    }
    await signOut();
    navigate('/login');
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#080E1C] border-r border-slate-800/80">
      <div className="flex h-16 items-center justify-between px-5 border-b border-slate-800/80">
        <Link
          to="/command-center"
          className="flex items-center gap-2.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 rounded"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600/15 border border-blue-500/30 text-cyan-400">
            <Shield className="h-4 w-4" />
          </span>
          <span className="font-display text-base font-semibold tracking-tight text-slate-100">
            VisionX AI
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="lg:hidden rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          aria-label="Close navigation menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav aria-label="Platform navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {PLATFORM_MODULES.map((mod) => {
          const Icon = iconByModuleId[mod.id] ?? LayoutDashboard;
          return (
            <NavLink
              key={mod.id}
              to={mod.path}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) =>
                cn(
                  'group flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors duration-150 whitespace-nowrap',
                  isActive
                    ? 'bg-[#121D36] text-cyan-200 font-medium border border-cyan-500/25'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-100 border border-transparent'
                )
              }
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className="h-4 w-4 shrink-0 opacity-85" />
                <span className="truncate">{mod.title}</span>
              </span>
              {mod.status === 'planned' && (
                <span className="font-mono text-[11px] text-slate-500 shrink-0">
                  P{mod.phase}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-slate-800/80 p-3 space-y-2">
        <Link
          to="/profile"
          onClick={() => setMobileNavOpen(false)}
          className={cn(
            'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
            location.pathname === '/profile'
              ? 'bg-[#121D36] text-cyan-200 font-medium border border-cyan-500/25'
              : 'text-slate-300 hover:bg-slate-800/50 border border-transparent'
          )}
        >
          <UserCircle2 className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate">
            {isAuthenticated
              ? profile?.displayName || profile?.email || 'Account Profile'
              : 'Unauthenticated Preview'}
          </span>
        </Link>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="w-full justify-start text-slate-400 hover:text-slate-100"
        >
          <LogOut className="h-4 w-4" />
          <span>{isPreviewMode ? 'Exit Preview' : 'Sign Out'}</span>
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#060B16] text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[264px] shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[264px] h-full">{sidebarContent}</div>
          <button
            type="button"
            aria-label="Close backdrop"
            className="flex-1 bg-black/60"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 border-b border-slate-800/80 bg-[#060B16]/95 backdrop-blur-xs px-4 lg:px-8 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden rounded-md p-2 text-slate-300 hover:bg-slate-800"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 whitespace-nowrap shrink-0">VisionX AI</span>
              <ChevronRight className="h-3.5 w-3.5 text-slate-600 shrink-0" />
              <span className="font-medium text-slate-100 truncate">{activeModule.title}</span>
            </nav>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {isPreviewMode ? (
              <span className="text-xs text-amber-300 whitespace-nowrap shrink-0">
                Architecture Preview · Read-Only UI Shell
              </span>
            ) : (
              memberships.length > 0 && (
                <div className="flex items-center gap-2">
                  <label htmlFor="org-switcher" className="sr-only">
                    Active Organization
                  </label>
                  <select
                    id="org-switcher"
                    value={activeOrganization?.organization_id ?? ''}
                    onChange={(e) => setActiveOrganizationId(e.target.value)}
                    className="h-9 rounded-md border border-slate-800 bg-[#0B1222] px-3 text-xs text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                  >
                    {memberships.map((m) => (
                      <option key={m.organization_id} value={m.organization_id}>
                        {m.organization_name} ({m.role_name})
                      </option>
                    ))}
                  </select>
                </div>
              )
            )}
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-[1280px] space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
