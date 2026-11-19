import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Camera, CheckCircle2, Fingerprint, Mic, ShieldCheck, Square } from 'lucide-react';
import { platformService } from '@/src/services/platformService';
import { apiClient } from '@/src/services/apiClient';
import {
  compareHexHashes,
  computeImagePerceptualHash,
  sha256HexFromText,
} from '@/src/lib/biometricsAndMetrics';
import { useWorkspaceContext, WorkspaceGuardNotice } from '@/src/components/WorkspaceGuardNotice';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { NoticeBanner } from '@/src/components/ui/notice-banner';
import { SegmentedTabs } from '@/src/components/ui/segmented-tabs';
import { SelectField } from '@/src/components/ui/select-field';
import {
  Surface,
  SurfaceBody,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
} from '@/src/components/ui/surface';
import type { ClearanceLevel } from '@/src/types/modules';

const enrollSchema = z.object({
  fullName: z.string().min(2).max(120),
  employeeCode: z.string().min(2).max(64),
  department: z.string().min(2).max(80),
  clearanceLevel: z.enum(['standard', 'elevated', 'restricted', 'executive']),
  enrollmentNotes: z.string().max(500),
});

export function IdentityPage() {
  const { orgId, orgOwnerUid, actorUid, actorEmail, canQueryLive, hasPermission } =
    useWorkspaceContext();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = React.useState<'verify' | 'enroll' | 'logs'>('verify');
  const [feedback, setFeedback] = React.useState<{
    tone: 'success' | 'error' | 'info';
    title: string;
    detail?: string;
  } | null>(null);

  // Enrollment sample state
  const [enrollFaceUrl, setEnrollFaceUrl] = React.useState<string>('');
  const [enrollVoiceUrl, setEnrollVoiceUrl] = React.useState<string>('');
  const [enrollFpUrl, setEnrollFpUrl] = React.useState<string>('');

  // Verification probe state
  const [selectedIdentityId, setSelectedIdentityId] = React.useState<string>('');
  const [checkpointName, setCheckpointName] = React.useState('Main Security Turnstile A');
  const [probeFaceUrl, setProbeFaceUrl] = React.useState<string>('');
  const [probeVoiceUrl, setProbeVoiceUrl] = React.useState<string>('');
  const [probeFpUrl, setProbeFpUrl] = React.useState<string>('');
  const [recordingFor, setRecordingFor] = React.useState<'enroll' | 'verify' | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);

  const identitiesQuery = useQuery({
    queryKey: ['biometric-identities', orgId, actorUid],
    queryFn: () => platformService.listBiometricIdentities(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });

  const logsQuery = useQuery({
    queryKey: ['verification-logs', orgId, actorUid],
    queryFn: () => platformService.listVerificationLogs(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });

  const enrollForm = useForm<z.infer<typeof enrollSchema>>({
    resolver: zodResolver(enrollSchema),
    defaultValues: {
      fullName: '',
      employeeCode: '',
      department: 'Security Operations',
      clearanceLevel: 'elevated',
      enrollmentNotes: '',
    },
  });

  const readAsDataUrl = (file: File, cb: (url: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => cb(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const toggleVoiceRecording = async (target: 'enroll' | 'verify') => {
    if (recordingFor) {
      recorderRef.current?.stop();
      setRecordingFor(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const url = String(reader.result || '');
          if (target === 'enroll') setEnrollVoiceUrl(url);
          else setProbeVoiceUrl(url);
        };
        reader.readAsDataURL(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecordingFor(target);
    } catch (err) {
      setFeedback({
        tone: 'error',
        title: 'Microphone Unavailable',
        detail: err instanceof Error ? err.message : 'Unable to record voice sample.',
      });
    }
  };

  const enrollMutation = useMutation({
    mutationFn: async (values: z.infer<typeof enrollSchema>) => {
      const faceHash = enrollFaceUrl ? await computeImagePerceptualHash(enrollFaceUrl) : '';
      const voiceHash = enrollVoiceUrl ? (await sha256HexFromText(enrollVoiceUrl)).slice(0, 16) : '';
      const fpHash = enrollFpUrl ? await computeImagePerceptualHash(enrollFpUrl) : '';

      return platformService.enrollIdentity({
        orgId,
        orgOwnerUid,
        actorUid,
        fullName: values.fullName,
        employeeCode: values.employeeCode,
        department: values.department,
        clearanceLevel: values.clearanceLevel as ClearanceLevel,
        faceDescriptorDigest: faceHash,
        voiceDescriptorDigest: voiceHash,
        fingerprintDescriptorDigest: fpHash,
        enrollmentNotes: values.enrollmentNotes,
      });
    },
    onSuccess: async () => {
      enrollForm.reset();
      setEnrollFaceUrl('');
      setEnrollVoiceUrl('');
      setEnrollFpUrl('');
      await queryClient.invalidateQueries({ queryKey: ['biometric-identities', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs', orgId] });
      setFeedback({
        tone: 'success',
        title: 'Biometric Identity Enrolled',
        detail: 'Perceptual template digests stored in Firestore (raw biometric images are not stored in plaintext).',
      });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Enrollment Failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const identities = identitiesQuery.data ?? [];
      const subject = identities.find((i) => i.id === selectedIdentityId) ?? identities[0];
      if (!subject) throw new Error('Enroll at least one identity before running verification.');

      const faceMatch =
        probeFaceUrl && subject.faceDescriptorDigest
          ? compareHexHashes(await computeImagePerceptualHash(probeFaceUrl), subject.faceDescriptorDigest)
          : null;
      const voiceMatch =
        probeVoiceUrl && subject.voiceDescriptorDigest
          ? compareHexHashes(
              (await sha256HexFromText(probeVoiceUrl)).slice(0, 16),
              subject.voiceDescriptorDigest
            )
          : null;
      const fpMatch =
        probeFpUrl && subject.fingerprintDescriptorDigest
          ? compareHexHashes(
              await computeImagePerceptualHash(probeFpUrl),
              subject.fingerprintDescriptorDigest
            )
          : null;

      const result = await apiClient.verifyMultimodalBiometrics({
        claimedName: subject.fullName,
        enrolledModalities: {
          face: subject.faceEnrolled,
          voice: subject.voiceEnrolled,
          fingerprint: subject.fingerprintEnrolled,
        },
        faceSampleBase64: probeFaceUrl || undefined,
        voiceSampleBase64: probeVoiceUrl || undefined,
        fingerprintSampleBase64: probeFpUrl || undefined,
        faceDigestMatch: faceMatch,
        voiceDigestMatch: voiceMatch,
        fingerprintDigestMatch: fpMatch,
      });

      const modalitiesUsed = [
        probeFaceUrl ? 'face' : null,
        probeVoiceUrl ? 'voice' : null,
        probeFpUrl ? 'fingerprint' : null,
      ].filter((m): m is string => Boolean(m));

      await platformService.recordVerificationLog({
        orgId,
        orgOwnerUid,
        actorUid,
        identityId: subject.id,
        identityName: subject.fullName,
        checkpointName,
        modalitiesUsed,
        faceScore: result.faceScore,
        voiceScore: result.voiceScore,
        fingerprintScore: result.fingerprintScore,
        fusedScore: result.fusedScore,
        livenessPassed: result.livenessPassed,
        outcome: result.outcome,
        rationale: result.rationale,
      });

      return { subject, result };
    },
    onSuccess: async ({ subject, result }) => {
      await queryClient.invalidateQueries({ queryKey: ['verification-logs', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['security-events', orgId] });
      setFeedback({
        tone: result.outcome === 'verified' ? 'success' : result.outcome === 'failed' ? 'error' : 'info',
        title: `Verification ${result.outcome.toUpperCase()} for ${subject.fullName} (${(result.fusedScore * 100).toFixed(1)}%)`,
        detail: result.rationale,
      });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Verification Error',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const identities = identitiesQuery.data ?? [];
  const logs = logsQuery.data ?? [];
  const verifiedCount = logs.filter((l) => l.outcome === 'verified').length;
  const failedCount = logs.filter((l) => l.outcome === 'failed').length;
  const inconclusiveCount = logs.filter((l) => l.outcome === 'inconclusive').length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
          Identity & Multimodal Biometric Verification
        </h1>
        <p className="text-sm text-slate-400">
          Phase 5 · Face, voice, and fingerprint enrollment, liveness verification, and weighted score fusion
        </p>
      </div>

      <WorkspaceGuardNotice />

      {feedback && (
        <NoticeBanner tone={feedback.tone} title={feedback.title} description={feedback.detail} />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Enrolled Identities</p>
            <p className="font-mono text-2xl font-semibold text-slate-100 tabular-nums">
              {identities.length}
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Verified Attempts</p>
            <p className="font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
              {verifiedCount}
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Failed Attempts</p>
            <p className="font-mono text-2xl font-semibold text-rose-400 tabular-nums">
              {failedCount}
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Inconclusive</p>
            <p className="font-mono text-2xl font-semibold text-amber-300 tabular-nums">
              {inconclusiveCount}
            </p>
          </SurfaceBody>
        </Surface>
      </div>

      <SegmentedTabs<'verify' | 'enroll' | 'logs'>
        value={activeTab}
        onChange={setActiveTab}
        options={[
          { id: 'verify', label: 'Checkpoint Verification' },
          { id: 'enroll', label: `Biometric Enrollment (${identities.length})` },
          { id: 'logs', label: `Verification Logs (${logs.length})` },
        ]}
      />

      {activeTab === 'verify' && (
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Multimodal Checkpoint Verification</SurfaceTitle>
            <SurfaceDescription>
              Submit live face, voice, and/or fingerprint probes. Weighted fusion: Face 45% · Voice 30% · Fingerprint 25%.
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bio-subject">Claimed Identity</Label>
                <SelectField
                  id="bio-subject"
                  value={selectedIdentityId || identities[0]?.id || ''}
                  onChange={(e) => setSelectedIdentityId(e.target.value)}
                  options={
                    identities.length === 0
                      ? [{ value: '', label: 'No identities enrolled yet' }]
                      : identities.map((id) => ({
                          value: id.id,
                          label: `${id.fullName} (${id.employeeCode} · ${id.clearanceLevel})`,
                        }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bio-checkpoint">Checkpoint / Gate</Label>
                <Input
                  id="bio-checkpoint"
                  value={checkpointName}
                  onChange={(e) => setCheckpointName(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-md border border-slate-800 bg-[#070D1A] p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                  <Camera className="h-4 w-4 text-cyan-400" />
                  <span>Face Probe Image</span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readAsDataUrl(f, setProbeFaceUrl);
                  }}
                  className="text-xs text-slate-400 w-full"
                />
                {probeFaceUrl && (
                  <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Face sample loaded
                  </p>
                )}
              </div>

              <div className="rounded-md border border-slate-800 bg-[#070D1A] p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                  <Mic className="h-4 w-4 text-cyan-400" />
                  <span>Voice Probe Audio</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void toggleVoiceRecording('verify')}
                  >
                    {recordingFor === 'verify' ? (
                      <>
                        <Square className="h-3.5 w-3.5 text-rose-400" /> Stop Mic
                      </>
                    ) : (
                      <>
                        <Mic className="h-3.5 w-3.5" /> Record Mic
                      </>
                    )}
                  </Button>
                </div>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readAsDataUrl(f, setProbeVoiceUrl);
                  }}
                  className="text-xs text-slate-400 w-full"
                />
                {probeVoiceUrl && (
                  <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Voice clip loaded
                  </p>
                )}
              </div>

              <div className="rounded-md border border-slate-800 bg-[#070D1A] p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
                  <Fingerprint className="h-4 w-4 text-cyan-400" />
                  <span>Fingerprint Scan</span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readAsDataUrl(f, setProbeFpUrl);
                  }}
                  className="text-xs text-slate-400 w-full"
                />
                {probeFpUrl && (
                  <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Fingerprint loaded
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => verifyMutation.mutate()}
                disabled={
                  !canQueryLive ||
                  !hasPermission('identity:verify') ||
                  identities.length === 0 ||
                  verifyMutation.isPending
                }
              >
                <ShieldCheck className="h-4 w-4" />
                <span>
                  {verifyMutation.isPending
                    ? 'Running Liveness & Fusion...'
                    : 'Run Multimodal Verification'}
                </span>
              </Button>
            </div>
          </SurfaceBody>
        </Surface>
      )}

      {activeTab === 'enroll' && (
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Enroll Authorized Identity</SurfaceTitle>
            <SurfaceDescription>
              Generates irreversible template perceptual/SHA-256 digests per biometric modality.
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody>
            <form
              onSubmit={enrollForm.handleSubmit((v) => enrollMutation.mutate(v))}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="enr-name">Full Name</Label>
                  <Input id="enr-name" placeholder="Dr. Layla Hassan" {...enrollForm.register('fullName')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="enr-code">Employee / Badge ID</Label>
                  <Input id="enr-code" placeholder="VX-1042" {...enrollForm.register('employeeCode')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="enr-dept">Department</Label>
                  <Input id="enr-dept" {...enrollForm.register('department')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="enr-clr">Clearance Level</Label>
                  <SelectField
                    id="enr-clr"
                    {...enrollForm.register('clearanceLevel')}
                    options={[
                      { value: 'standard', label: 'Standard' },
                      { value: 'elevated', label: 'Elevated' },
                      { value: 'restricted', label: 'Restricted' },
                      { value: 'executive', label: 'Executive' },
                    ]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-md border border-slate-800 bg-[#070D1A] p-4 space-y-2">
                  <Label>Reference Face Photo</Label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) readAsDataUrl(f, setEnrollFaceUrl);
                    }}
                    className="text-xs text-slate-400 w-full"
                  />
                  {enrollFaceUrl && <p className="text-[11px] text-emerald-400">Face template ready</p>}
                </div>
                <div className="rounded-md border border-slate-800 bg-[#070D1A] p-4 space-y-2">
                  <Label>Reference Voice Sample</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void toggleVoiceRecording('enroll')}
                  >
                    {recordingFor === 'enroll' ? 'Stop Recording' : 'Record Voice'}
                  </Button>
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) readAsDataUrl(f, setEnrollVoiceUrl);
                    }}
                    className="text-xs text-slate-400 w-full"
                  />
                  {enrollVoiceUrl && <p className="text-[11px] text-emerald-400">Voice template ready</p>}
                </div>
                <div className="rounded-md border border-slate-800 bg-[#070D1A] p-4 space-y-2">
                  <Label>Reference Fingerprint Image</Label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) readAsDataUrl(f, setEnrollFpUrl);
                    }}
                    className="text-xs text-slate-400 w-full"
                  />
                  {enrollFpUrl && <p className="text-[11px] text-emerald-400">Fingerprint template ready</p>}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="enr-notes">Enrollment Notes</Label>
                <Input
                  id="enr-notes"
                  placeholder="Optional checkpoint verification notes"
                  {...enrollForm.register('enrollmentNotes')}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={
                    !canQueryLive || !hasPermission('identity:enroll') || enrollMutation.isPending
                  }
                >
                  {enrollMutation.isPending ? 'Enrolling...' : 'Enroll Biometric Identity'}
                </Button>
              </div>
            </form>
          </SurfaceBody>
        </Surface>
      )}

      {activeTab === 'logs' && (
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Verification Audit Trail</SurfaceTitle>
            <SurfaceDescription>
              Fused confidence scores, modality breakdown, and liveness verification outcomes.
            </SurfaceDescription>
          </SurfaceHeader>
          {logs.length === 0 ? (
            <SurfaceBody className="py-8 text-center text-xs text-slate-400">
              No biometric verification attempts logged yet.
            </SurfaceBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                    <th className="px-6 py-3 font-medium">Subject & Checkpoint</th>
                    <th className="px-4 py-3 font-medium">Modalities</th>
                    <th className="px-4 py-3 font-medium">Liveness</th>
                    <th className="px-4 py-3 font-medium text-right">Fused Score</th>
                    <th className="px-4 py-3 font-medium">Outcome</th>
                    <th className="px-6 py-3 font-medium">Rationale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {logs.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-800/30">
                      <td className="px-6 py-3">
                        <div className="font-medium text-slate-100">{l.identityName}</div>
                        <div className="text-xs text-slate-400">{l.checkpointName}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">
                        {l.modalitiesUsed.join(' + ')}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className={l.livenessPassed ? 'text-emerald-400' : 'text-rose-400'}>
                          {l.livenessPassed ? 'Passed' : 'Failed'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-200">
                        {(l.fusedScore * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-xs font-medium">
                        <span
                          className={
                            l.outcome === 'verified'
                              ? 'text-emerald-400'
                              : l.outcome === 'failed'
                                ? 'text-rose-400'
                                : 'text-amber-300'
                          }
                        >
                          {l.outcome.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-xs text-slate-400 max-w-md">{l.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Surface>
      )}
    </div>
  );
}
