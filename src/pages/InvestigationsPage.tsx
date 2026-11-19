import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileLock2, ShieldCheck, Upload } from 'lucide-react';
import { platformService } from '@/src/services/platformService';
import { apiClient } from '@/src/services/apiClient';
import { sha256HexFromBuffer } from '@/src/lib/biometricsAndMetrics';
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
import type { EvidenceItemRecord } from '@/src/types/modules';

export function InvestigationsPage() {
  const { orgId, orgOwnerUid, actorUid, actorEmail, canQueryLive, hasPermission } =
    useWorkspaceContext();
  const queryClient = useQueryClient();

  const [caseNumber, setCaseNumber] = React.useState('CASE-2026-001');
  const [title, setTitle] = React.useState('');
  const [sourceType, setSourceType] = React.useState<EvidenceItemRecord['sourceType']>('image_frame');
  const [linkedIncidentId, setLinkedIncidentId] = React.useState('');
  const [custodyNotes, setCustodyNotes] = React.useState('');
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [verifyItemId, setVerifyItemId] = React.useState<string>('');
  const [feedback, setFeedback] = React.useState<{
    tone: 'success' | 'error' | 'info';
    title: string;
    detail?: string;
  } | null>(null);

  const evidenceQuery = useQuery({
    queryKey: ['evidence-items', orgId, actorUid],
    queryFn: () => platformService.listEvidenceItems(orgId, actorUid, actorEmail),
    enabled: canQueryLive && hasPermission('evidence:read'),
  });

  const incidentsQuery = useQuery({
    queryKey: ['incidents', orgId, actorUid],
    queryFn: () => platformService.listIncidents(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });

  const sealMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error('Select a digital evidence file first.');
      const buffer = await selectedFile.arrayBuffer();
      const clientSha = await sha256HexFromBuffer(buffer);

      // Cross-verify digest on server if <= 10MB
      let finalSha = clientSha;
      if (selectedFile.size <= 10 * 1024 * 1024) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const serverHash = await apiClient.computeEvidenceSha256({
          payloadBase64: btoa(binary),
        });
        if (serverHash.sha256 !== clientSha) {
          throw new Error('Client and server SHA-256 checksums diverged during transfer.');
        }
        finalSha = serverHash.sha256;
      }

      await platformService.preserveEvidenceItem({
        orgId,
        orgOwnerUid,
        actorUid,
        caseNumber,
        title: title.trim() || selectedFile.name,
        sourceType,
        fileName: selectedFile.name,
        fileSizeBytes: selectedFile.size,
        sha256Digest: finalSha,
        linkedIncidentId,
        custodyNotes: custodyNotes || 'Sealed via VisionX Forensic Vault',
      });
      return finalSha;
    },
    onSuccess: async (sha) => {
      setTitle('');
      setCustodyNotes('');
      setSelectedFile(null);
      await queryClient.invalidateQueries({ queryKey: ['evidence-items', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs', orgId] });
      setFeedback({
        tone: 'success',
        title: 'Digital Evidence Sealed with SHA-256',
        detail: `Verified cryptographic digest: ${sha}`,
      });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Evidence Sealing Failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const custodyMutation = useMutation({
    mutationFn: ({
      item,
      status,
    }: {
      item: EvidenceItemRecord;
      status: EvidenceItemRecord['custodyStatus'];
    }) =>
      platformService.updateEvidenceCustody({
        orgId,
        evidenceId: item.id,
        actorUid,
        custodyStatus: status,
        custodyNotes: item.custodyNotes,
        linkedIncidentId: item.linkedIncidentId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['evidence-items', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs', orgId] });
    },
  });

  const handleVerifyIntegrity = async (file: File) => {
    const items = evidenceQuery.data ?? [];
    const target = items.find((i) => i.id === (verifyItemId || items[0]?.id));
    if (!target) return;
    const sha = await sha256HexFromBuffer(await file.arrayBuffer());
    if (sha === target.sha256Digest) {
      setFeedback({
        tone: 'success',
        title: `Integrity Verified for ${target.caseNumber}`,
        detail: `Recomputed SHA-256 matches sealed digest (${sha}). Zero tampering detected.`,
      });
    } else {
      setFeedback({
        tone: 'error',
        title: `Integrity Mismatch Detected for ${target.caseNumber}`,
        detail: `Expected ${target.sha256Digest}, got ${sha}.`,
      });
    }
  };

  const items = evidenceQuery.data ?? [];
  const incidents = incidentsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
          Investigation & Digital Evidence Center
        </h1>
        <p className="text-sm text-slate-400">
          Phase 8 · SHA-256 cryptographic sealing, integrity verification, and chain-of-custody ledger
        </p>
      </div>

      <WorkspaceGuardNotice />

      {feedback && (
        <NoticeBanner tone={feedback.tone} title={feedback.title} description={feedback.detail} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Seal New Evidence Artifact</SurfaceTitle>
            <SurfaceDescription>
              Computes dual WebCrypto + server SHA-256 digest and locks the hash in Firestore.
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="evd-case">Case Number</Label>
                <Input
                  id="evd-case"
                  value={caseNumber}
                  onChange={(e) => setCaseNumber(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="evd-type">Artifact Type</Label>
                <SelectField
                  id="evd-type"
                  value={sourceType}
                  onChange={(e) =>
                    setSourceType(e.target.value as EvidenceItemRecord['sourceType'])
                  }
                  options={[
                    { value: 'image_frame', label: 'Image / Still Frame' },
                    { value: 'video_clip', label: 'Video Clip' },
                    { value: 'biometric_log', label: 'Biometric Verification Export' },
                    { value: 'incident_bundle', label: 'Incident Bundle' },
                  ]}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="evd-title">Evidence Title</Label>
                <Input
                  id="evd-title"
                  placeholder="North Gate Still Capture"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="evd-inc">Linked Incident</Label>
                <SelectField
                  id="evd-inc"
                  value={linkedIncidentId}
                  onChange={(e) => setLinkedIncidentId(e.target.value)}
                  options={[
                    { value: '', label: 'None' },
                    ...incidents.map((inc) => ({
                      value: inc.id,
                      label: `${inc.title} (${inc.status})`,
                    })),
                  ]}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="evd-notes">Custody Notes</Label>
              <Input
                id="evd-notes"
                placeholder="Collected by SOC analyst at Checkpoint A"
                value={custodyNotes}
                onChange={(e) => setCustodyNotes(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <input
                type="file"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="text-xs text-slate-300"
              />
              <Button
                size="sm"
                onClick={() => sealMutation.mutate()}
                disabled={!canQueryLive || !selectedFile || sealMutation.isPending}
              >
                <FileLock2 className="h-4 w-4" />
                <span>{sealMutation.isPending ? 'Sealing...' : 'Compute SHA-256 & Seal'}</span>
              </Button>
            </div>
          </SurfaceBody>
        </Surface>

        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Verify Artifact Integrity</SurfaceTitle>
            <SurfaceDescription>
              Re-hash a local copy of an artifact and compare against its sealed Firestore SHA-256 digest.
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ver-evd-select">Sealed Evidence Record</Label>
              <SelectField
                id="ver-evd-select"
                value={verifyItemId || items[0]?.id || ''}
                onChange={(e) => setVerifyItemId(e.target.value)}
                options={
                  items.length === 0
                    ? [{ value: '', label: 'No evidence sealed yet' }]
                    : items.map((i) => ({
                        value: i.id,
                        label: `${i.caseNumber} · ${i.fileName}`,
                      }))
                }
              />
            </div>

            <label className="inline-flex items-center gap-2 h-9 px-4 rounded-md border border-slate-700 bg-[#070D1A] text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer">
              <Upload className="h-3.5 w-3.5" />
              <span>Select File to Verify Checksum</span>
              <input
                type="file"
                className="sr-only"
                disabled={items.length === 0}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleVerifyIntegrity(f);
                }}
              />
            </label>
          </SurfaceBody>
        </Surface>
      </div>

      <Surface>
        <SurfaceHeader>
          <SurfaceTitle>Chain of Custody Vault ({items.length})</SurfaceTitle>
        </SurfaceHeader>
        {items.length === 0 ? (
          <SurfaceBody className="py-8 text-center text-xs text-slate-400">
            No sealed evidence items in this organization.
          </SurfaceBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                  <th className="px-6 py-3 font-medium">Case & Title</th>
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">SHA-256 Digest (Immutable)</th>
                  <th className="px-4 py-3 font-medium">Custody</th>
                  <th className="px-6 py-3 font-medium text-right">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3.5">
                      <div className="font-medium text-slate-100">
                        {item.caseNumber} · {item.title}
                      </div>
                      <div className="text-xs text-slate-400">{item.custodyNotes}</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-300">
                      {item.fileName} ({(item.fileSizeBytes / 1024).toFixed(1)} KB)
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-cyan-300">
                      {item.sha256Digest.slice(0, 20)}...{item.sha256Digest.slice(-8)}
                    </td>
                    <td className="px-4 py-3.5 text-xs">
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {item.custodyStatus}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          custodyMutation.mutate({
                            item,
                            status: item.custodyStatus === 'sealed' ? 'under_review' : 'sealed',
                          })
                        }
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Toggle Review</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>
    </div>
  );
}
