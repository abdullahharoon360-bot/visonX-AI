import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/src/context/AuthContext';
import { firebaseProjectInfo } from '@/src/services/firebase';
import { AuthLayout } from '@/src/pages/auth/AuthLayout';
import { Button } from '@/src/components/ui/button';
import { NoticeBanner } from '@/src/components/ui/notice-banner';
import { Separator } from '@/src/components/ui/separator';

export function LoginPage() {
  const { signInWithGoogle, enterPreviewMode, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);

  const destination =
    (location.state as { from?: string } | null)?.from || '/command-center';

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate(destination, { replace: true });
    }
  }, [isAuthenticated, navigate, destination]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
      navigate(destination, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      setAuthError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEnterPreview = () => {
    enterPreviewMode();
    navigate('/command-center');
  };

  return (
    <AuthLayout
      title="VisionX AI Access Control"
      subtitle="Authenticate with your verified Google Workspace or Google Account to enter the security platform."
    >
      {authError && (
        <NoticeBanner tone="error" title="Google Authentication Error" description={authError} />
      )}

      <div className="space-y-4">
        <div className="rounded-md border border-slate-800/80 bg-[#070D1A] p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
            <ShieldCheck className="h-4 w-4 text-cyan-400 shrink-0" />
            <span>Configured Google Identity Provider</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Sign in via Google OAuth popup. Primary operator account hint:{' '}
            <span className="font-mono text-slate-200">
              {firebaseProjectInfo.bootstrappedAdminEmail}
            </span>
          </p>
        </div>

        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={handleGoogleSignIn}
          disabled={isSubmitting}
        >
          <KeyRound className="h-4 w-4" />
          <span>{isSubmitting ? 'Opening Google Sign-In...' : 'Sign in with Google'}</span>
        </Button>
      </div>

      <Separator />

      <div className="space-y-2.5">
        <p className="text-xs text-slate-400 leading-relaxed">
          Inspect the Phase 1 workspace layout in read-only mode without signing in:
        </p>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={handleEnterPreview}
        >
          <Eye className="h-4 w-4 text-cyan-400" />
          <span>Inspect UI Shell (Architecture Preview)</span>
        </Button>
      </div>
    </AuthLayout>
  );
}
