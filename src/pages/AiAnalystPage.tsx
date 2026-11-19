import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Send } from 'lucide-react';
import { platformService } from '@/src/services/platformService';
import { apiClient } from '@/src/services/apiClient';
import { useWorkspaceContext, WorkspaceGuardNotice } from '@/src/components/WorkspaceGuardNotice';
import { Button } from '@/src/components/ui/button';
import { NoticeBanner } from '@/src/components/ui/notice-banner';
import {
  Surface,
  SurfaceBody,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
} from '@/src/components/ui/surface';

export function AiAnalystPage() {
  const { orgId, orgOwnerUid, actorUid, actorEmail, canQueryLive, hasPermission } =
    useWorkspaceContext();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = React.useState('');
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

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
  const eventsQuery = useQuery({
    queryKey: ['security-events', orgId, actorUid],
    queryFn: () => platformService.listSecurityEvents(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });
  const incidentsQuery = useQuery({
    queryKey: ['incidents', orgId, actorUid],
    queryFn: () => platformService.listIncidents(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });
  const evidenceQuery = useQuery({
    queryKey: ['evidence-items', orgId, actorUid],
    queryFn: () => platformService.listEvidenceItems(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });
  const sessionsQuery = useQuery({
    queryKey: ['analyst-sessions', orgId, actorUid],
    queryFn: () => platformService.listAnalystSessions(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });

  const cameras = camerasQuery.data ?? [];
  const detections = detectionsQuery.data ?? [];
  const verifications = verificationsQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const incidents = incidentsQuery.data ?? [];
  const evidence = evidenceQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];

  const contextSummary = React.useMemo(() => {
    const lines: string[] = [
      `Workspace Cameras (${cameras.length}): ${cameras.map((c) => `${c.name}[${c.zone}:${c.status}]`).join(', ') || 'None'}`,
      `Recent Vision Detections (${detections.length}): ${detections.slice(0, 5).map((d) => `${d.cameraName}(people=${d.peopleCount},vehicles=${d.vehicleCount},anomalies=${d.anomalyCount}): ${d.summary}`).join(' | ') || 'None'}`,
      `Biometric Verifications (${verifications.length}): ${verifications.slice(0, 5).map((v) => `${v.identityName}@${v.checkpointName}=${v.outcome}(${(v.fusedScore * 100).toFixed(0)}%)`).join(' | ') || 'None'}`,
      `Security Events (${events.length}): ${events.slice(0, 6).map((e) => `[${e.severity.toUpperCase()}] ${e.title} (${e.zone}, ack=${e.acknowledged})`).join(' | ') || 'None'}`,
      `Incidents (${incidents.length}): ${incidents.slice(0, 5).map((i) => `${i.id}:${i.title}[${i.status}/${i.severity}/risk=${i.riskScore}]`).join(' | ') || 'None'}`,
      `Sealed Evidence (${evidence.length}): ${evidence.slice(0, 5).map((e) => `${e.caseNumber}:${e.title}`).join(', ') || 'None'}`,
    ];
    return lines.join('\n');
  }, [cameras, detections, verifications, events, incidents, evidence]);

  const askMutation = useMutation({
    mutationFn: async (qText: string) => {
      const res = await apiClient.queryAiAnalyst({
        prompt: qText,
        contextSummary,
      });
      await platformService.saveAnalystSession({
        orgId,
        orgOwnerUid,
        actorUid,
        prompt: qText,
        responseText: res.recommendation,
        contextSnapshot: `cams=${cameras.length}, det=${detections.length}, ver=${verifications.length}, evt=${events.length}, inc=${incidents.length}, evd=${evidence.length}`,
        modelName: res.model,
      });
      return res;
    },
    onSuccess: async () => {
      setPrompt('');
      setErrorMsg(null);
      await queryClient.invalidateQueries({ queryKey: ['analyst-sessions', orgId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Analyst request failed.');
    },
  });

  const quickPrompts = [
    'Summarize our current security posture and highlight any unacknowledged high-severity events.',
    'Identify correlations between failed biometric verifications and open incidents.',
    'Recommend immediate triage actions and evidence preservation priorities based on active records.',
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
          AI Security Analyst
        </h1>
        <p className="text-sm text-slate-400">
          Phase 7 · Server-side Gemini investigation assistant grounded strictly in authorized workspace records
        </p>
      </div>

      <WorkspaceGuardNotice />

      {errorMsg && <NoticeBanner tone="error" title="AI Analyst Error" description={errorMsg} />}

      <Surface>
        <SurfaceHeader>
          <SurfaceTitle>Authorized Context Scope</SurfaceTitle>
          <SurfaceDescription>
            Every query grounds Gemini solely in the live Firestore records currently loaded for this organization.
          </SurfaceDescription>
        </SurfaceHeader>
        <SurfaceBody className="space-y-4">
          <div className="font-mono text-xs text-slate-400 flex flex-wrap gap-x-5 gap-y-1">
            <span>Cameras: {cameras.length}</span>
            <span>Detections: {detections.length}</span>
            <span>Verifications: {verifications.length}</span>
            <span>Events: {events.length}</span>
            <span>Incidents: {incidents.length}</span>
            <span>Evidence: {evidence.length}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {quickPrompts.map((qp) => (
              <button
                key={qp}
                type="button"
                onClick={() => setPrompt(qp)}
                className="text-left text-xs rounded-md border border-slate-800 bg-[#070D1A] px-3 py-1.5 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-200 transition-colors"
              >
                {qp}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask the AI Security Analyst about incidents, correlated anomalies, camera coverage, or evidence..."
              className="flex-1 rounded-md border border-slate-800 bg-[#070D1A] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
            />
            <Button
              onClick={() => askMutation.mutate(prompt)}
              disabled={
                !canQueryLive ||
                !hasPermission('analyst:query') ||
                prompt.trim().length < 2 ||
                askMutation.isPending
              }
              className="sm:self-end"
            >
              <Send className="h-4 w-4" />
              <span>{askMutation.isPending ? 'Analyzing...' : 'Query Analyst'}</span>
            </Button>
          </div>
        </SurfaceBody>
      </Surface>

      <div className="space-y-4">
        {sessions.length === 0 ? (
          <Surface>
            <SurfaceBody className="py-10 text-center space-y-2">
              <Bot className="h-7 w-7 text-slate-500 mx-auto" />
              <p className="text-sm text-slate-300">No analyst briefings generated yet</p>
            </SurfaceBody>
          </Surface>
        ) : (
          sessions.map((s) => (
            <Surface key={s.id}>
              <SurfaceHeader>
                <SurfaceTitle className="text-base">{s.prompt}</SurfaceTitle>
                <SurfaceDescription className="font-mono text-[11px]">
                  {s.modelName} · {s.contextSnapshot} · {new Date(s.createdAt).toLocaleString()} ·
                  AI-Generated Recommendation · Requires Human Review
                </SurfaceDescription>
              </SurfaceHeader>
              <SurfaceBody>
                <div className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed">
                  {s.responseText}
                </div>
              </SurfaceBody>
            </Surface>
          ))
        )}
      </div>
    </div>
  );
}
