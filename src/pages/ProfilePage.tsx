import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/src/context/AuthContext';
import { firestoreService } from '@/src/services/firestoreService';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { NoticeBanner } from '@/src/components/ui/notice-banner';
import {
  Surface,
  SurfaceBody,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
} from '@/src/components/ui/surface';

const profileSchema = z.object({
  displayName: z.string().min(1, 'Display name is required.').max(120),
  jobTitle: z.string().max(120),
});

type ProfileValues = z.infer<typeof profileSchema>;

export function ProfilePage() {
  const { isAuthenticated, isPreviewMode, profile, activeOrganization, refreshSessionProfile } =
    useAuth();
  const [status, setStatus] = React.useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: {
      displayName: profile?.displayName ?? '',
      jobTitle: profile?.jobTitle ?? '',
    },
  });

  const onSubmit = async (values: ProfileValues) => {
    if (!profile) return;
    setStatus(null);
    try {
      await firestoreService.updateOperatorProfile(profile.uid, values);
      await refreshSessionProfile();
      setStatus({ tone: 'success', message: 'Profile saved to Firestore.' });
    } catch (err) {
      setStatus({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Unable to save profile.',
      });
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
          User Profile & Session Security
        </h1>
        <p className="text-sm text-slate-400">
          Manage your operator identity details persisted in Firestore and inspect active permissions.
        </p>
      </div>

      {isPreviewMode && (
        <NoticeBanner
          tone="warning"
          title="Unauthenticated Architecture Preview"
          description="Sign in with Google to edit profile fields persisted in Cloud Firestore."
        />
      )}

      {status && (
        <NoticeBanner
          tone={status.tone}
          title={status.tone === 'success' ? 'Profile Updated' : 'Update Failed'}
          description={status.message}
        />
      )}

      <Surface>
        <SurfaceHeader>
          <SurfaceTitle>Operator Profile</SurfaceTitle>
          <SurfaceDescription>
            {isAuthenticated
              ? `${profile?.email} · UID ${profile?.uid}`
              : 'No authenticated Google session'}
          </SurfaceDescription>
        </SurfaceHeader>
        <SurfaceBody>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Display Name</Label>
              <Input
                id="profile-name"
                disabled={!isAuthenticated}
                {...register('displayName')}
              />
              {errors.displayName && (
                <p className="text-xs text-red-400">{errors.displayName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-title">Job Title / Duty Role</Label>
              <Input
                id="profile-title"
                disabled={!isAuthenticated}
                placeholder="Lead Security Architect"
                {...register('jobTitle')}
              />
            </div>

            <Button type="submit" disabled={!isAuthenticated || isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Profile'}
            </Button>
          </form>
        </SurfaceBody>
      </Surface>

      {activeOrganization && (
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Active Organization Permissions</SurfaceTitle>
            <SurfaceDescription>
              {activeOrganization.organization_name} · Role: {activeOrganization.role_name}
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody>
            <div className="flex flex-wrap gap-x-4 gap-y-2 font-mono text-xs text-slate-300">
              {activeOrganization.permissions.map((perm) => (
                <span key={perm}>{perm}</span>
              ))}
            </div>
          </SurfaceBody>
        </Surface>
      )}
    </div>
  );
}
