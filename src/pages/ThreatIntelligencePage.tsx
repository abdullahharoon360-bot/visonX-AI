import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Check, Plus, ShieldAlert } from 'lucide-react';
import { platformService } from '@/src/services/platformService';
import { computeDeterministicRiskScore } from '@/src/lib/biometricsAndMetrics';
import { useWorkspaceContext, WorkspaceGuardNotice } from '@/src/components/WorkspaceGuardNotice';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { NoticeBanner } from '@/src/components/ui/notice-banner';
import { SelectField } from '@/src/components/ui/select-field';
import {
  Surface,
  SurfaceBody,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
} from '@/src/components/ui/surface';
import type { EventSeverity, SecurityEventRecord } from '@/src/types/modules';

export function ThreatIntelligencePage() {
  const { orgId, orgOwnerUid, actorUid, actorEmail, canQueryLive, hasPermission } =
    useWorkspaceContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [zoneName, setZoneName] = React.useState('Main Perimeter');
  const [zoneSensitivity, setZoneSensitivity] = React.useState<'standard' | 'restricted' | 'critical'>('restricted');
  const [manualTitle, setManualTitle] = React.useState('');
  const [manualDetail, setManualDetail] = React.useState('');
  const [manualSeverity, setManualSeverity] = React.useState<EventSeverity>('medium');
  const [feedback, setFeedback] = React.useState<{
    tone: 'success' | 'error' | 'info';
    title: string;
    detail?: string;
  } | null>(null);

  const eventsQuery = useQuery({
    queryKey: ['security-events', orgId, actorUid],
    queryFn: () => platformService.listSecurityEvents(orgId, actorUid, actorEmail),
    enabled: canQueryLive && hasPermission('incidents:read'),
  });

  const assessmentsQuery = useQuery({
    queryKey: ['risk-assessments', orgId, actorUid],
    queryFn: () => platformService.listRiskAssessments(orgId, actorUid, actorEmail),
    enabled: canQueryLive && hasPermission('incidents:read'),
  });

  const camerasQuery = useQuery({
    queryKey: ['cameras', orgId, actorUid],
    queryFn: () => platformService.listCameras(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });

  const detectionsQuery = useQuery({
    queryKey: ['vision-detections', orgId, actorUid],
    queryFn: () => platformService.listVisionDetections(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });

  const verificationsQuery = useQuery({
    queryKey: ['verification-logs', orgId, actorUid],
    queryFn: () => platformService.listVerificationLogs(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });

  const events = eventsQuery.data ?? [];
  const assessments = assessmentsQuery.data ?? [];
  const cameras = camerasQuery.data ?? [];
  const detections = detectionsQuery.data ?? [];
  const verifications = verificationsQuery.data ?? [];

  const liveRisk = React.useMemo(() => {
    const failedVerifications24h = verifications.filter((v) => v.outcome === 'failed').length;
    const unacknowledgedHighEvents = events.filter(
      (e) => !e.acknowledged && (e.severity === 'high' || e.severity === 'critical')
    ).length;
    const visionAnomalies = detections.reduce((sum, d) => sum + d.anomalyCount, 0);
    const offlineCameras = cameras.filter((c) => c.status === 'offline').length;

    return computeDeterministicRiskScore({
      failedVerifications24h,
      unacknowledgedHighEvents,
      visionAnomalies,
      offlineCameras,
      zoneSensitivity,
    });
  }, [verifications, events, detections, cameras, zoneSensitivity]);

  const logEventMutation = useMutation({
    mutationFn: () =>
      platformService.createSecurityEvent({
        orgId,
        orgOwnerUid,
        actorUid,
        sourceModule: 'manual',
        eventType: 'manual.checkpoint_alert',
        severity: manualSeverity,
        cameraId: cameras[0]?.id ?? 'manual',
        zone: zoneName,
        title: manualTitle.trim(),
        detail: manualDetail.trim(),
      }),
    onSuccess: async () => {
      setManualTitle('');
      setManualDetail('');
      await queryClient.invalidateQueries({ queryKey: ['security-events', orgId] });
      setFeedback({ tone: 'success', title: 'Security Event Logged' });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Unable to Log Event',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const ackMutation = useMutation({
    mutationFn: (eventId: string) => platformService.acknowledgeSecurityEvent(orgId, eventId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['security-events', orgId] });
    },
  });

  const saveAssessmentMutation = useMutation({
    mutationFn: () =>
      platformService.createRiskAssessment({
        orgId,
        orgOwnerUid,
        actorUid,
        targetLabel: `${zoneName} (${zoneSensitivity})`,
        zone: zoneName,
        riskScore: liveRisk.riskScore,
        severity: liveRisk.severity,
        factors: liveRisk.factors,
        recommendation: liveRisk.recommendation,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['risk-assessments', orgId] });
      setFeedback({
        tone: 'success',
        title: `Risk Assessment Recorded (Score ${liveRisk.riskScore}/100)`,
      });
    },
  });

  const escalateMutation = useMutation({
    mutationFn: (ev: SecurityEventRecord) =>
      platformService.createIncident({
        orgId,
        orgOwnerUid,
        actorUid,
        title: ev.title,
        description: ev.detail,
        severity: ev.severity,
        zone: ev.zone,
        linkedCameraId: ev.cameraId,
        linkedEventId: ev.id,
        riskScore: liveRisk.riskScore,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['incidents', orgId] });
      navigate('/incidents');
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
          Threat Intelligence & Risk Assessment
        </h1>
        <p className="text-sm text-slate-400">
          Phase 6 · Correlated security events, deterministic risk scoring, and incident escalation
        </p>
      </div>

      <WorkspaceGuardNotice />

      {feedback && (
        <NoticeBanner tone={feedback.tone} title={feedback.title} description={feedback.detail} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Deterministic Risk Engine */}
        <Surface className="lg:col-span-2">
          <SurfaceHeader className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <SurfaceTitle>Deterministic Risk Assessment Engine</SurfaceTitle>
              <SurfaceDescription>
                Weighted score calculated strictly from live Firestore cameras, anomalies, verifications, and events.
              </SurfaceDescription>
            </div>
            <div className="flex items-center gap-2">
              <SelectField
                aria-label="Zone Sensitivity"
                value={zoneSensitivity}
                onChange={(e) =>
                  setZoneSensitivity(e.target.value as 'standard' | 'restricted' | 'critical')
                }
                options={[
                  { value: 'standard', label: 'Standard Zone (1.0x)' },
                  { value: 'restricted', label: 'Restricted Zone (1.1x)' },
                  { value: 'critical', label: 'Critical Asset (1.25x)' },
                ]}
              />
            </div>
          </SurfaceHeader>
          <SurfaceBody className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/70 pb-4">
              <div>
                <p className="text-xs text-slate-400">Computed Organization Risk Score</p>
                <p className="font-mono text-3xl font-semibold text-slate-100 tabular-nums">
                  {liveRisk.riskScore}{' '}
                  <span className="text-sm text-slate-400 font-normal">/ 100</span>
                </p>
              </div>
              <div className="text-right space-y-1">
                <p className="text-xs text-slate-400">Severity Classification</p>
                <p
                  className={`font-mono text-sm font-semibold uppercase ${
                    liveRisk.severity === 'critical' || liveRisk.severity === 'high'
                      ? 'text-rose-400'
                      : liveRisk.severity === 'medium'
                        ? 'text-amber-300'
                        : 'text-emerald-400'
                  }`}
                >
                  {liveRisk.severity}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {liveRisk.factors.map((f) => (
                <div
                  key={f.factor}
                  className="rounded-md border border-slate-800 bg-[#070D1A] px-3.5 py-2.5 flex items-center justify-between text-xs"
                >
                  <span className="text-slate-300">{f.factor}</span>
                  <span className="font-mono text-cyan-300 tabular-nums">
                    +{f.contribution} pts
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-xs text-slate-300 max-w-xl">{liveRisk.recommendation}</p>
              <Button
                size="sm"
                onClick={() => saveAssessmentMutation.mutate()}
                disabled={!canQueryLive || saveAssessmentMutation.isPending}
              >
                Save Snapshot ({assessments.length})
              </Button>
            </div>
          </SurfaceBody>
        </Surface>

        {/* Manual Event Ingestion */}
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Log Checkpoint Event</SurfaceTitle>
            <SurfaceDescription>Record an operator observation into the correlated stream.</SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ev-zone">Zone</Label>
              <Input
                id="ev-zone"
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ev-title">Event Title</Label>
              <Input
                id="ev-title"
                placeholder="Tailgating detected at Lobby Gate"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ev-sev">Severity</Label>
              <SelectField
                id="ev-sev"
                value={manualSeverity}
                onChange={(e) => setManualSeverity(e.target.value as EventSeverity)}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                  { value: 'critical', label: 'Critical' },
                ]}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ev-detail">Details</Label>
              <Input
                id="ev-detail"
                placeholder="Observed secondary entry without badge scan"
                value={manualDetail}
                onChange={(e) => setManualDetail(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={
                !canQueryLive ||
                manualTitle.trim().length < 2 ||
                manualDetail.trim().length < 2 ||
                logEventMutation.isPending
              }
              onClick={() => logEventMutation.mutate()}
            >
              <Plus className="h-4 w-4" />
              <span>Emit Security Event</span>
            </Button>
          </SurfaceBody>
        </Surface>
      </div>

      {/* Correlated Event Stream */}
      <Surface>
        <SurfaceHeader>
          <SurfaceTitle>Correlated Security Event Stream</SurfaceTitle>
          <SurfaceDescription>
            Unified feed across Vision detections, Biometric verification failures, and operator logs.
          </SurfaceDescription>
        </SurfaceHeader>
        {events.length === 0 ? (
          <SurfaceBody className="py-8 text-center text-xs text-slate-400">
            No correlated security events recorded yet.
          </SurfaceBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                  <th className="px-6 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 font-medium">Source · Zone</th>
                  <th className="px-4 py-3 font-medium">Severity</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {events.map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3.5">
                      <div className="font-medium text-slate-100">{ev.title}</div>
                      <div className="text-xs text-slate-400 max-w-lg">{ev.detail}</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-300 whitespace-nowrap">
                      {ev.sourceModule} · {ev.zone}
                    </td>
                    <td className="px-4 py-3.5 text-xs font-mono uppercase">
                      <span
                        className={
                          ev.severity === 'critical' || ev.severity === 'high'
                            ? 'text-rose-400'
                            : ev.severity === 'medium'
                              ? 'text-amber-300'
                              : 'text-slate-300'
                        }
                      >
                        {ev.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs">
                      <span className={ev.acknowledged ? 'text-emerald-400' : 'text-amber-300'}>
                        {ev.acknowledged ? 'Acknowledged' : 'Pending Review'}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right whitespace-nowrap space-x-2">
                      {!ev.acknowledged && hasPermission('incidents:manage') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => ackMutation.mutate(ev.id)}
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Ack</span>
                        </Button>
                      )}
                      {hasPermission('incidents:manage') && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => escalateMutation.mutate(ev)}
                        >
                          <ShieldAlert className="h-3.5 w-3.5" />
                          <span>Escalate</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {assessments.length > 0 && (
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Saved Risk Assessment Snapshots</SurfaceTitle>
          </SurfaceHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                  <th className="px-6 py-3 font-medium">Target</th>
                  <th className="px-4 py-3 font-medium text-right">Score</th>
                  <th className="px-4 py-3 font-medium">Severity</th>
                  <th className="px-6 py-3 font-medium">Recommendation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {assessments.map((a) => (
                  <tr key={a.id}>
                    <td className="px-6 py-3 text-slate-100">{a.targetLabel}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-cyan-300">
                      {a.riskScore}/100
                    </td>
                    <td className="px-4 py-3 font-mono text-xs uppercase text-slate-300">
                      {a.severity}
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-400">{a.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}
    </div>
  );
}
