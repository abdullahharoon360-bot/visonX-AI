import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, Upload } from 'lucide-react';
import { platformService } from '@/src/services/platformService';
import { apiClient } from '@/src/services/apiClient';
import { computeCanvasQualityMetrics } from '@/src/lib/biometricsAndMetrics';
import { useWorkspaceContext, WorkspaceGuardNotice } from '@/src/components/WorkspaceGuardNotice';
import { NoticeBanner } from '@/src/components/ui/notice-banner';
import {
  Surface,
  SurfaceBody,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
} from '@/src/components/ui/surface';
import type { VideoJobRecord } from '@/src/types/modules';

async function sampleVideoKeyframes(file: File, sampleCount = 5): Promise<{
  durationSec: number;
  resolution: string;
  avgBrightness: number;
  avgSharpness: number;
  frames: Array<{ timestampSec: number; imageBase64: string }>;
}> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = objectUrl;

    video.onloadedmetadata = async () => {
      try {
        const durationSec = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
        const w = video.videoWidth || 640;
        const h = video.videoHeight || 360;
        const resolution = `${w}x${h}`;

        const canvas = document.createElement('canvas');
        const targetW = Math.min(w, 720);
        const targetH = Math.round((targetW / w) * h);
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable.');

        const count = Math.min(sampleCount, Math.max(1, Math.ceil(durationSec)));
        const frames: Array<{ timestampSec: number; imageBase64: string }> = [];
        let brightnessSum = 0;
        let sharpnessSum = 0;

        for (let i = 0; i < count; i++) {
          const ts = count === 1 ? 0 : (i / (count - 1)) * Math.max(0, durationSec - 0.1);
          await new Promise<void>((resSeek) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              resSeek();
            };
            video.addEventListener('seeked', onSeeked);
            video.currentTime = ts;
          });
          ctx.drawImage(video, 0, 0, targetW, targetH);
          const q = computeCanvasQualityMetrics(canvas);
          brightnessSum += q.brightness;
          sharpnessSum += q.sharpness;
          frames.push({
            timestampSec: Number(ts.toFixed(1)),
            imageBase64: canvas.toDataURL('image/jpeg', 0.8),
          });
        }

        URL.revokeObjectURL(objectUrl);
        resolve({
          durationSec: Number(durationSec.toFixed(2)),
          resolution,
          avgBrightness: Number((brightnessSum / frames.length).toFixed(1)),
          avgSharpness: Number((sharpnessSum / frames.length).toFixed(1)),
          frames,
        });
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unsupported video codec or unreadable file.'));
    };
  });
}

export function VideoIntelligencePage() {
  const { orgId, orgOwnerUid, actorUid, actorEmail, canQueryLive, hasPermission } =
    useWorkspaceContext();
  const queryClient = useQueryClient();
  const [selectedJob, setSelectedJob] = React.useState<VideoJobRecord | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: ['video-jobs', orgId, actorUid],
    queryFn: () => platformService.listVideoJobs(orgId, actorUid, actorEmail),
    enabled: canQueryLive && hasPermission('vision:read'),
  });

  const analyzeVideoMutation = useMutation({
    mutationFn: async (file: File) => {
      const sampled = await sampleVideoKeyframes(file, 5);
      const analysis = await apiClient.analyzeVideoKeyframes({
        fileName: file.name,
        durationSec: sampled.durationSec,
        frames: sampled.frames,
      });

      const jobId = await platformService.createVideoJob({
        orgId,
        orgOwnerUid,
        actorUid,
        fileName: file.name,
        fileSizeBytes: file.size,
        durationSec: sampled.durationSec,
        resolution: sampled.resolution,
        framesSampled: sampled.frames.length,
        avgBrightness: sampled.avgBrightness,
        avgSharpness: sampled.avgSharpness,
        summary: analysis.summary,
        detectedPlates: analysis.detectedPlates,
        timeline: analysis.timeline,
        inferenceMs: analysis.inferenceMs,
      });

      return { jobId, sampled, analysis, file };
    },
    onSuccess: async () => {
      setErrorMsg(null);
      await queryClient.invalidateQueries({ queryKey: ['video-jobs', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['fs-audit-logs', orgId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Video investigation failed.');
    },
  });

  const jobs = jobsQuery.data ?? [];
  const activeJob = selectedJob ?? jobs[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
            Video Intelligence & Forensic Timeline
          </h1>
          <p className="text-sm text-slate-400">
            Phase 4 · Keyframe sampling, pixel quality metrics, ALPR plate extraction, and object timelines
          </p>
        </div>

        <label className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-blue-600 text-xs font-medium text-white hover:bg-blue-500 cursor-pointer">
          <Upload className="h-4 w-4" />
          <span>
            {analyzeVideoMutation.isPending ? 'Sampling & Analyzing...' : 'Upload Video Clip'}
          </span>
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            disabled={!canQueryLive || analyzeVideoMutation.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) analyzeVideoMutation.mutate(file);
            }}
          />
        </label>
      </div>

      <WorkspaceGuardNotice />

      {errorMsg && <NoticeBanner tone="error" title="Video Processing Error" description={errorMsg} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Investigation Jobs</SurfaceTitle>
            <SurfaceDescription>Select a processed video job to inspect its timeline.</SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody className="p-0">
            {jobs.length === 0 ? (
              <div className="py-10 px-6 text-center space-y-2">
                <Film className="h-7 w-7 text-slate-500 mx-auto" />
                <p className="text-sm text-slate-300">No video clips processed</p>
                <p className="text-xs text-slate-500">
                  Upload an MP4 or WebM surveillance clip to sample keyframes and inspect object timelines.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/70">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setSelectedJob(job)}
                    className={`w-full text-left px-5 py-3.5 transition-colors ${
                      activeJob?.id === job.id
                        ? 'bg-[#121D36] text-cyan-200'
                        : 'hover:bg-slate-800/40 text-slate-200'
                    }`}
                  >
                    <div className="font-medium text-sm truncate">{job.fileName}</div>
                    <div className="font-mono text-[11px] text-slate-400 mt-0.5 tabular-nums">
                      {job.durationSec}s · {job.resolution} · {job.framesSampled} keyframes
                    </div>
                  </button>
                ))}
              </div>
            )}
          </SurfaceBody>
        </Surface>

        <Surface className="lg:col-span-2">
          <SurfaceHeader>
            <SurfaceTitle>
              {activeJob ? activeJob.fileName : 'Video Forensic Report'}
            </SurfaceTitle>
            <SurfaceDescription>
              {activeJob
                ? `${activeJob.resolution} · ${activeJob.durationSec}s · Inference ${activeJob.inferenceMs}ms`
                : 'Select or upload a clip to review extracted timeline events and frame quality.'}
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody className="space-y-5">
            {!activeJob ? (
              <p className="text-xs text-slate-400 py-8 text-center">
                No video analysis selected.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 border-b border-slate-800/70 pb-4">
                  <div>
                    <p className="text-xs text-slate-400">Avg Brightness</p>
                    <p className="font-mono text-base font-semibold text-slate-100 tabular-nums">
                      {activeJob.avgBrightness}/255
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Edge Sharpness</p>
                    <p className="font-mono text-base font-semibold text-slate-100 tabular-nums">
                      {activeJob.avgSharpness}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">ALPR Plates</p>
                    <p className="font-mono text-base font-semibold text-cyan-300 tabular-nums">
                      {activeJob.detectedPlates.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Timeline Markers</p>
                    <p className="font-mono text-base font-semibold text-slate-100 tabular-nums">
                      {activeJob.timeline.length}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <h3 className="text-xs font-medium text-slate-400">Investigative Summary</h3>
                  <p className="text-sm text-slate-200 leading-relaxed">{activeJob.summary}</p>
                </div>

                {activeJob.detectedPlates.length > 0 && (
                  <div className="space-y-1.5">
                    <h3 className="text-xs font-medium text-slate-400">ALPR Candidates</h3>
                    <p className="font-mono text-xs text-cyan-300">
                      {activeJob.detectedPlates.join(' · ')}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <h3 className="text-xs font-medium text-slate-400">Chronological Keyframe Timeline</h3>
                  <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-md">
                    {activeJob.timeline.map((item, idx) => (
                      <div key={idx} className="px-4 py-3 flex items-start justify-between gap-4">
                        <div className="space-y-0.5">
                          <div className="text-xs font-medium text-slate-100">
                            <span className="font-mono text-cyan-400 mr-2 tabular-nums">
                              @{item.timestampSec.toFixed(1)}s
                            </span>
                            {item.label}
                          </div>
                          <p className="text-xs text-slate-400">{item.detail}</p>
                        </div>
                        <span className="font-mono text-xs text-slate-300 tabular-nums shrink-0">
                          {(item.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </SurfaceBody>
        </Surface>
      </div>
    </div>
  );
}
