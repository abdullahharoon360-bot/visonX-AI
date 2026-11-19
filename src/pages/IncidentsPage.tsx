import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, ShieldAlert } from 'lucide-react';
import { platformService } from '@/src/services/platformService';
import { useWorkspaceContext, WorkspaceGuardNotice } from '@/src/components/WorkspaceGuardNotice';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Modal, ModalPanel, ModalTrigger } from '@/src/components/ui/modal';
import { NoticeBanner } from '@/src/components/ui/notice-banner';
import { SelectField } from '@/src/components/ui/select-field';
import {
  Surface,
  SurfaceBody,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
} from '@/src/components/ui/surface';
import type { EventSeverity, IncidentRecord, IncidentStatus } from '@/src/types/modules';

const incidentSchema = z.object({
  title: z.string().min(3).max(160),
  description: z.string().min(3).max(1200),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  zone: z.string().min(2).max(80),
  riskScore: z.number().min(0).max(100),
});

export function IncidentsPage() {
  const { orgId, orgOwnerUid, actorUid, actorEmail, canQueryLive, hasPermission } =
    useWorkspaceContext();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedIncident, setSelectedIncident] = React.useState<IncidentRecord | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<'all' | IncidentStatus>('all');
  const [resolutionDraft, setResolutionDraft] = React.useState('');
  const [statusDraft, setStatusDraft] = React.useState<IncidentStatus>('investigating');
  const [feedback, setFeedback] = React.useState<{
    tone: 'success' | 'error';
    title: string;
    detail?: string;
  } | null>(null);

  const incidentsQuery = useQuery({
    queryKey: ['incidents', orgId, actorUid],
    queryFn: () => platformService.listIncidents(orgId, actorUid, actorEmail),
    enabled: canQueryLive && hasPermission('incidents:read'),
  });

  const form = useForm<z.infer<typeof incidentSchema>>({
    resolver: zodResolver(incidentSchema),
    defaultValues: {
      title: '',
      description: '',
      severity: 'high',
      zone: 'Main Perimeter',
      riskScore: 65,
    },
  });

  const createMutation = useMutation({
    mutationFn: (v: z.infer<typeof incidentSchema>) =>
      platformService.createIncident({
        orgId,
        orgOwnerUid,
        actorUid,
        title: v.title,
        description: v.description,
        severity: v.severity as EventSeverity,
        zone: v.zone,
        riskScore: v.riskScore,
      }),
    onSuccess: async () => {
      setModalOpen(false);
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ['incidents', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs', orgId] });
      setFeedback({ tone: 'success', title: 'Security Incident Created' });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Incident Creation Failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (inc: IncidentRecord) =>
      platformService.updateIncident({
        orgId,
        incidentId: inc.id,
        actorUid,
        severity: inc.severity,
        status: statusDraft,
        assignedToUid: actorUid,
        resolutionNotes: resolutionDraft,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['incidents', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs', orgId] });
      setSelectedIncident(null);
      setFeedback({ tone: 'success', title: 'Incident Updated & Logged' });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Incident Update Failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const incidents = incidentsQuery.data ?? [];
  const filtered =
    statusFilter === 'all' ? incidents : incidents.filter((i) => i.status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
            Security Incident Management
          </h1>
          <p className="text-sm text-slate-400">
            Phase 6 · Triage, containment, resolution notes, and immutable audit tracking
          </p>
        </div>

        {canQueryLive && hasPermission('incidents:manage') && (
          <Modal open={modalOpen} onOpenChange={setModalOpen}>
            <ModalTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                <span>Open Incident</span>
              </Button>
            </ModalTrigger>
            <ModalPanel
              title="Open Security Incident"
              description="Creates an audited incident record in Firestore for triage and investigation."
            >
              <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="inc-title">Incident Title</Label>
                  <Input id="inc-title" placeholder="Unauthorized Checkpoint Entry" {...form.register('title')} />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="inc-sev">Severity</Label>
                    <SelectField
                      id="inc-sev"
                      {...form.register('severity')}
                      options={[
                        { value: 'low', label: 'Low' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'high', label: 'High' },
                        { value: 'critical', label: 'Critical' },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inc-zone">Zone</Label>
                    <Input id="inc-zone" {...form.register('zone')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="inc-risk">Risk Score (0-100)</Label>
                    <Input
                      id="inc-risk"
                      type="number"
                      {...form.register('riskScore', { valueAsNumber: true })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inc-desc">Description</Label>
                  <textarea
                    id="inc-desc"
                    rows={3}
                    className="w-full rounded-md border border-slate-800 bg-[#070D1A] px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                    {...form.register('description')}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    Create Incident
                  </Button>
                </div>
              </form>
            </ModalPanel>
          </Modal>
        )}
      </div>

      <WorkspaceGuardNotice />

      {feedback && (
        <NoticeBanner tone={feedback.tone} title={feedback.title} description={feedback.detail} />
      )}

      <Surface>
        <SurfaceHeader className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <SurfaceTitle>Incident Queue ({filtered.length})</SurfaceTitle>
            <SurfaceDescription>
              Select an incident to update containment state or document resolution findings.
            </SurfaceDescription>
          </div>
          <div className="w-48">
            <SelectField
              aria-label="Filter incident status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | IncidentStatus)}
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'open', label: 'Open' },
                { value: 'investigating', label: 'Investigating' },
                { value: 'contained', label: 'Contained' },
                { value: 'resolved', label: 'Resolved' },
                { value: 'closed', label: 'Closed' },
              ]}
            />
          </div>
        </SurfaceHeader>

        {filtered.length === 0 ? (
          <SurfaceBody className="py-10 text-center space-y-2">
            <ShieldAlert className="h-7 w-7 text-slate-500 mx-auto" />
            <p className="text-sm text-slate-300">No incidents match this filter</p>
          </SurfaceBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                  <th className="px-6 py-3 font-medium">Incident</th>
                  <th className="px-4 py-3 font-medium">Zone</th>
                  <th className="px-4 py-3 font-medium">Severity</th>
                  <th className="px-4 py-3 font-medium text-right">Risk</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Triage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((inc) => (
                  <tr key={inc.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3.5">
                      <div className="font-medium text-slate-100">{inc.title}</div>
                      <div className="text-xs text-slate-400 max-w-md">{inc.description}</div>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-300">{inc.zone}</td>
                    <td className="px-4 py-3.5 font-mono text-xs uppercase text-rose-300">
                      {inc.severity}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-200">
                      {inc.riskScore}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs uppercase text-cyan-300">
                      {inc.status}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      {hasPermission('incidents:manage') && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setSelectedIncident(inc);
                            setStatusDraft(inc.status);
                            setResolutionDraft(inc.resolutionNotes);
                          }}
                        >
                          Manage
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

      {selectedIncident && (
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Triage: {selectedIncident.title}</SurfaceTitle>
            <SurfaceDescription>
              Incident ID {selectedIncident.id} · Zone {selectedIncident.zone}
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="triage-status">Lifecycle Status</Label>
                <SelectField
                  id="triage-status"
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value as IncidentStatus)}
                  options={[
                    { value: 'open', label: 'Open' },
                    { value: 'investigating', label: 'Investigating' },
                    { value: 'contained', label: 'Contained' },
                    { value: 'resolved', label: 'Resolved' },
                    { value: 'closed', label: 'Closed' },
                  ]}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="triage-notes">Resolution & Containment Notes</Label>
              <textarea
                id="triage-notes"
                rows={3}
                value={resolutionDraft}
                onChange={(e) => setResolutionDraft(e.target.value)}
                className="w-full rounded-md border border-slate-800 bg-[#070D1A] px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSelectedIncident(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => updateMutation.mutate(selectedIncident)}
                disabled={updateMutation.isPending}
              >
                Save Triage Update
              </Button>
            </div>
          </SurfaceBody>
        </Surface>
      )}
    </div>
  );
}
