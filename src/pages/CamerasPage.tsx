import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Activity, Camera, Plus, Radio, Wrench } from 'lucide-react';
import { platformService } from '@/src/services/platformService';
import { apiClient } from '@/src/services/apiClient';
import { useWorkspaceContext, WorkspaceGuardNotice } from '@/src/components/WorkspaceGuardNotice';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Modal, ModalPanel, ModalTrigger } from '@/src/components/ui/modal';
import { NoticeBanner } from '@/src/components/ui/notice-banner';
import { SelectField } from '@/src/components/ui/select-field';
import { Skeleton } from '@/src/components/ui/skeleton';
import {
  Surface,
  SurfaceBody,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
} from '@/src/components/ui/surface';
import type { CameraRecord, CameraStatus, CameraStreamType } from '@/src/types/modules';

const cameraSchema = z.object({
  name: z.string().min(2, 'Camera name is required.').max(120),
  zone: z.string().min(2, 'Zone is required.').max(80),
  location: z.string().min(2, 'Location is required.').max(160),
  streamType: z.enum(['webcam', 'rtsp', 'onvif', 'http_snapshot']),
  endpointMasked: z.string().min(3, 'Stream or device URI is required.').max(255),
  resolution: z.string().min(3).max(32),
  targetFps: z.number().int().min(1).max(120),
});

export function CamerasPage() {
  const { orgId, orgOwnerUid, actorUid, actorEmail, canQueryLive, hasPermission } =
    useWorkspaceContext();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [zoneFilter, setZoneFilter] = React.useState('all');
  const [feedback, setFeedback] = React.useState<{
    tone: 'success' | 'error' | 'info';
    title: string;
    detail?: string;
  } | null>(null);

  const camerasQuery = useQuery({
    queryKey: ['cameras', orgId, actorUid],
    queryFn: () => platformService.listCameras(orgId, actorUid, actorEmail),
    enabled: canQueryLive && hasPermission('cameras:read'),
  });

  const form = useForm<z.infer<typeof cameraSchema>>({
    resolver: zodResolver(cameraSchema),
    defaultValues: {
      name: '',
      zone: 'Main Entrance',
      location: 'Building A · Lobby Gate',
      streamType: 'webcam',
      endpointMasked: 'webcam://local-browser-device',
      resolution: '1280x720',
      targetFps: 15,
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: z.infer<typeof cameraSchema>) =>
      platformService.createCamera({
        orgId,
        orgOwnerUid,
        actorUid,
        name: values.name,
        zone: values.zone,
        location: values.location,
        streamType: values.streamType as CameraStreamType,
        endpointMasked: values.endpointMasked,
        resolution: values.resolution,
        targetFps: values.targetFps,
      }),
    onSuccess: async () => {
      setModalOpen(false);
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ['cameras', orgId] });
      setFeedback({
        tone: 'success',
        title: 'Camera Registered',
        detail: 'Endpoint metadata saved to Cloud Firestore and recorded in Audit Logs.',
      });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Registration Failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const probeMutation = useMutation({
    mutationFn: async (cam: CameraRecord) => {
      const probe = await apiClient.probeCamera({
        streamType: cam.streamType,
        endpoint: cam.endpointMasked,
      });
      await platformService.updateCameraHealth({
        orgId,
        cameraId: cam.id,
        actorUid,
        status: probe.status,
        latencyMs: probe.latencyMs,
      });
      return { cam, probe };
    },
    onSuccess: async ({ cam, probe }) => {
      await queryClient.invalidateQueries({ queryKey: ['cameras', orgId] });
      setFeedback({
        tone: probe.reachable ? 'success' : 'info',
        title: `Diagnostic completed for ${cam.name}`,
        detail: probe.detail,
      });
    },
    onError: (err) => {
      setFeedback({
        tone: 'error',
        title: 'Endpoint Diagnostic Blocked or Failed',
        detail: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ cameraId, status }: { cameraId: string; status: CameraStatus }) =>
      platformService.updateCameraHealth({
        orgId,
        cameraId,
        actorUid,
        status,
        latencyMs: null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cameras', orgId] });
    },
  });

  const cameras = camerasQuery.data ?? [];
  const zones = Array.from(new Set(cameras.map((c) => c.zone)));
  const filtered =
    zoneFilter === 'all' ? cameras : cameras.filter((c) => c.zone === zoneFilter);

  const activeCount = cameras.filter((c) => c.status === 'active').length;
  const offlineCount = cameras.filter((c) => c.status === 'offline').length;
  const maintCount = cameras.filter((c) => c.status === 'maintenance').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
            Camera Intelligence & Registry
          </h1>
          <p className="text-sm text-slate-400">
            Phase 3 · Surveillance endpoints, SSRF-safe server diagnostics, and operational health
          </p>
        </div>

        {canQueryLive && hasPermission('cameras:manage') && (
          <Modal open={modalOpen} onOpenChange={setModalOpen}>
            <ModalTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4" />
                <span>Register Camera</span>
              </Button>
            </ModalTrigger>
            <ModalPanel
              title="Register Surveillance Camera"
              description="Store camera endpoint metadata in Firestore. Never include plaintext passwords in masked URIs."
            >
              <form
                onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cam-name">Camera Name</Label>
                    <Input id="cam-name" placeholder="North Gate Optical 01" {...form.register('name')} />
                    {form.formState.errors.name && (
                      <p className="text-xs text-rose-400">{form.formState.errors.name.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cam-zone">Security Zone</Label>
                    <Input id="cam-zone" placeholder="Perimeter North" {...form.register('zone')} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cam-loc">Physical Location</Label>
                  <Input
                    id="cam-loc"
                    placeholder="Building A · Turnstile Checkpoint 2"
                    {...form.register('location')}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cam-type">Stream Adapter</Label>
                    <SelectField
                      id="cam-type"
                      {...form.register('streamType')}
                      options={[
                        { value: 'webcam', label: 'Browser Webcam (WebRTC)' },
                        { value: 'http_snapshot', label: 'HTTPS Snapshot Endpoint' },
                        { value: 'rtsp', label: 'RTSP Stream (Worker Bridge)' },
                        { value: 'onvif', label: 'ONVIF Profile S' },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cam-res">Resolution</Label>
                    <Input id="cam-res" placeholder="1280x720" {...form.register('resolution')} />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="cam-uri">Endpoint URI (Masked)</Label>
                    <Input
                      id="cam-uri"
                      placeholder="webcam://local-browser-device"
                      {...form.register('endpointMasked')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cam-fps">Target FPS</Label>
                    <Input
                      id="cam-fps"
                      type="number"
                      {...form.register('targetFps', { valueAsNumber: true })}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Saving...' : 'Save Camera'}
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

      {/* Telemetry Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Registered Cameras</p>
            <p className="font-mono text-2xl font-semibold text-slate-100 tabular-nums">
              {cameras.length}
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Active Streams</p>
            <p className="font-mono text-2xl font-semibold text-emerald-400 tabular-nums">
              {activeCount}
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Offline / Unreachable</p>
            <p className="font-mono text-2xl font-semibold text-rose-400 tabular-nums">
              {offlineCount}
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Maintenance Mode</p>
            <p className="font-mono text-2xl font-semibold text-amber-300 tabular-nums">
              {maintCount}
            </p>
          </SurfaceBody>
        </Surface>
      </div>

      {/* Camera Inventory Table */}
      <Surface>
        <SurfaceHeader className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <SurfaceTitle>Surveillance Endpoints</SurfaceTitle>
            <SurfaceDescription>
              Run SSRF-safe server diagnostics or toggle operational status per camera.
            </SurfaceDescription>
          </div>
          {zones.length > 0 && (
            <div className="w-48">
              <SelectField
                aria-label="Filter by zone"
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
                options={[
                  { value: 'all', label: `All Zones (${cameras.length})` },
                  ...zones.map((z) => ({ value: z, label: z })),
                ]}
              />
            </div>
          )}
        </SurfaceHeader>

        {camerasQuery.isLoading ? (
          <SurfaceBody className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </SurfaceBody>
        ) : filtered.length === 0 ? (
          <SurfaceBody className="py-10 text-center space-y-2">
            <Camera className="h-8 w-8 text-slate-500 mx-auto" />
            <p className="text-sm font-medium text-slate-200">No cameras registered yet</p>
            <p className="text-xs text-slate-400">
              Register a local browser webcam or HTTPS/RTSP camera endpoint to begin live monitoring.
            </p>
          </SurfaceBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                  <th className="px-6 py-3 font-medium">Camera</th>
                  <th className="px-4 py-3 font-medium">Zone & Location</th>
                  <th className="px-4 py-3 font-medium">Adapter & Spec</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Latency</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((cam) => (
                  <tr key={cam.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-3.5">
                      <div className="font-medium text-slate-100">{cam.name}</div>
                      <div className="font-mono text-xs text-slate-400 truncate max-w-xs">
                        {cam.endpointMasked}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-slate-200">{cam.zone}</div>
                      <div className="text-xs text-slate-400">{cam.location}</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-300 whitespace-nowrap">
                      {cam.streamType.toUpperCase()} · {cam.resolution} · {cam.targetFps}fps
                    </td>
                    <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                      <span
                        className={
                          cam.status === 'active'
                            ? 'text-emerald-400 font-medium'
                            : cam.status === 'maintenance'
                              ? 'text-amber-300 font-medium'
                              : 'text-rose-400 font-medium'
                        }
                      >
                        {cam.status === 'active'
                          ? 'Active'
                          : cam.status === 'maintenance'
                            ? 'Maintenance'
                            : 'Offline'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-300 tabular-nums whitespace-nowrap">
                      {cam.lastLatencyMs !== null ? `${cam.lastLatencyMs} ms` : '—'}
                    </td>
                    <td className="px-6 py-3.5 text-right whitespace-nowrap">
                      {hasPermission('cameras:manage') && (
                        <div className="inline-flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => probeMutation.mutate(cam)}
                            disabled={probeMutation.isPending}
                          >
                            <Radio className="h-3.5 w-3.5" />
                            <span>Probe</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              statusMutation.mutate({
                                cameraId: cam.id,
                                status: cam.status === 'maintenance' ? 'active' : 'maintenance',
                              })
                            }
                            title="Toggle maintenance mode"
                          >
                            {cam.status === 'maintenance' ? (
                              <Activity className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <Wrench className="h-3.5 w-3.5 text-amber-300" />
                            )}
                          </Button>
                        </div>
                      )}
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
