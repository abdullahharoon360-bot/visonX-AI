import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileBarChart2, Plus } from 'lucide-react';
import { platformService } from '@/src/services/platformService';
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
import type { SecurityReportRecord } from '@/src/types/modules';

function triggerDownload(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { orgId, orgOwnerUid, actorUid, actorEmail, canQueryLive, hasPermission, activeOrganization } =
    useWorkspaceContext();
  const queryClient = useQueryClient();

  const [title, setTitle] = React.useState('Executive Security Posture Briefing');
  const [reportType, setReportType] = React.useState<SecurityReportRecord['reportType']>('executive');
  const [feedback, setFeedback] = React.useState<string | null>(null);

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
  const reportsQuery = useQuery({
    queryKey: ['security-reports', orgId, actorUid],
    queryFn: () => platformService.listSecurityReports(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });

  const cameras = camerasQuery.data ?? [];
  const detections = detectionsQuery.data ?? [];
  const verifications = verificationsQuery.data ?? [];
  const incidents = incidentsQuery.data ?? [];
  const evidence = evidenceQuery.data ?? [];
  const reports = reportsQuery.data ?? [];

  const snapshot = {
    camerasTotal: cameras.length,
    camerasActive: cameras.filter((c) => c.status === 'active').length,
    detectionsTotal: detections.length,
    verificationsTotal: verifications.length,
    incidentsOpen: incidents.filter((i) => i.status !== 'closed' && i.status !== 'resolved').length,
    evidenceSealed: evidence.filter((e) => e.custodyStatus === 'sealed').length,
  };

  const generateMutation = useMutation({
    mutationFn: () => {
      const summary = `Organization ${activeOrganization?.organization_name ?? orgId}: ${snapshot.camerasActive}/${snapshot.camerasTotal} cameras active, ${snapshot.detectionsTotal} vision frame inferences, ${snapshot.verificationsTotal} multimodal biometric verifications, ${snapshot.incidentsOpen} open incidents, and ${snapshot.evidenceSealed} sealed digital evidence items.`;
      return platformService.createSecurityReport({
        orgId,
        orgOwnerUid,
        actorUid,
        title: title.trim() || 'Security Posture Report',
        reportType,
        summary,
        metricsSnapshot: snapshot,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['security-reports', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs', orgId] });
      setFeedback('Report snapshot archived in Cloud Firestore.');
    },
  });

  const exportCsv = () => {
    const headers = ['id', 'title', 'type', 'camerasActive', 'camerasTotal', 'detections', 'verifications', 'openIncidents', 'sealedEvidence', 'createdAt'];
    const rows = reports.map((r) => [
      r.id,
      `"${r.title.replace(/"/g, '""')}"`,
      r.reportType,
      r.metricsSnapshot.camerasActive,
      r.metricsSnapshot.camerasTotal,
      r.metricsSnapshot.detectionsTotal,
      r.metricsSnapshot.verificationsTotal,
      r.metricsSnapshot.incidentsOpen,
      r.metricsSnapshot.evidenceSealed,
      r.createdAt,
    ]);
    triggerDownload(
      `visionx-reports-${orgId}.csv`,
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n'),
      'text/csv'
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
            Security Analytics & Reporting
          </h1>
          <p className="text-sm text-slate-400">
            Phase 8 · Cross-module analytics, compliance snapshots, and JSON/CSV forensic exports
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={reports.length === 0 || !hasPermission('reports:export')}
            onClick={exportCsv}
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canQueryLive || !hasPermission('reports:export')}
            onClick={() =>
              triggerDownload(
                `visionx-telemetry-${orgId}.json`,
                JSON.stringify({ organization: activeOrganization?.organization_name, snapshot, reports }, null, 2),
                'application/json'
              )
            }
          >
            <Download className="h-4 w-4" />
            <span>Export JSON</span>
          </Button>
        </div>
      </div>

      <WorkspaceGuardNotice />

      {feedback && <NoticeBanner tone="success" title={feedback} />}

      <Surface>
        <SurfaceHeader>
          <SurfaceTitle>Generate Operational Report Snapshot</SurfaceTitle>
          <SurfaceDescription>
            Captures live counts across all VisionX AI modules into an audited report record.
          </SurfaceDescription>
        </SurfaceHeader>
        <SurfaceBody className="grid grid-cols-1 gap-4 sm:grid-cols-4 items-end">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rpt-title">Report Title</Label>
            <Input id="rpt-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rpt-type">Report Category</Label>
            <SelectField
              id="rpt-type"
              value={reportType}
              onChange={(e) => setReportType(e.target.value as SecurityReportRecord['reportType'])}
              options={[
                { value: 'executive', label: 'Executive' },
                { value: 'compliance', label: 'Compliance' },
                { value: 'forensic', label: 'Forensic' },
                { value: 'biometric', label: 'Biometric' },
              ]}
            />
          </div>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={!canQueryLive || !hasPermission('reports:export') || generateMutation.isPending}
          >
            <Plus className="h-4 w-4" />
            <span>{generateMutation.isPending ? 'Generating...' : 'Generate Snapshot'}</span>
          </Button>
        </SurfaceBody>
      </Surface>

      <Surface>
        <SurfaceHeader>
          <SurfaceTitle>Archived Reports ({reports.length})</SurfaceTitle>
        </SurfaceHeader>
        {reports.length === 0 ? (
          <SurfaceBody className="py-10 text-center space-y-2">
            <FileBarChart2 className="h-7 w-7 text-slate-500 mx-auto" />
            <p className="text-sm text-slate-300">No reports archived yet</p>
          </SurfaceBody>
        ) : (
          <div className="divide-y divide-slate-800/70">
            {reports.map((r) => (
              <div key={r.id} className="px-6 py-4 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-100">{r.title}</span>
                  <span className="font-mono text-xs text-slate-400">
                    {r.reportType.toUpperCase()} · {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{r.summary}</p>
              </div>
            ))}
          </div>
        )}
      </Surface>
    </div>
  );
}
