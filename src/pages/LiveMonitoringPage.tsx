import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Eye, ScanSearch, Upload, VideoOff } from 'lucide-react';
import { platformService } from '@/src/services/platformService';
import { apiClient } from '@/src/services/apiClient';
import { computeCanvasQualityMetrics } from '@/src/lib/biometricsAndMetrics';
import { useWorkspaceContext, WorkspaceGuardNotice } from '@/src/components/WorkspaceGuardNotice';
import { Button } from '@/src/components/ui/button';
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
import type { DetectedObjectBox } from '@/src/types/modules';

export function LiveMonitoringPage() {
  const { orgId, orgOwnerUid, actorUid, actorEmail, canQueryLive, hasPermission } =
    useWorkspaceContext();
  const queryClient = useQueryClient();

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);

  const [webcamActive, setWebcamActive] = React.useState(false);
  const [selectedCameraId, setSelectedCameraId] = React.useState<string>('ad-hoc-webcam');
  const [capturedPreviewUrl, setCapturedPreviewUrl] = React.useState<string | null>(null);
  const [activeBoxes, setActiveBoxes] = React.useState<DetectedObjectBox[]>([]);
  const [frameQuality, setFrameQuality] = React.useState<{
    brightness: number;
    sharpness: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [lastSummary, setLastSummary] = React.useState<string | null>(null);

  const camerasQuery = useQuery({
    queryKey: ['cameras', orgId, actorUid],
    queryFn: () => platformService.listCameras(orgId, actorUid, actorEmail),
    enabled: canQueryLive && hasPermission('cameras:read'),
  });

  const detectionsQuery = useQuery({
    queryKey: ['vision-detections', orgId, actorUid],
    queryFn: () => platformService.listVisionDetections(orgId, actorUid, actorEmail),
    enabled: canQueryLive && hasPermission('vision:read'),
  });

  React.useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const drawOverlayBoxes = React.useCallback(
    (imgSource: HTMLImageElement | HTMLVideoElement, boxes: DetectedObjectBox[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = imgSource instanceof HTMLVideoElement ? imgSource.videoWidth || 960 : imgSource.naturalWidth || 960;
      const h = imgSource instanceof HTMLVideoElement ? imgSource.videoHeight || 540 : imgSource.naturalHeight || 540;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(imgSource, 0, 0, w, h);
      setFrameQuality(computeCanvasQualityMetrics(canvas));

      for (const box of boxes) {
        const x = (box.xmin / 1000) * w;
        const y = (box.ymin / 1000) * h;
        const bw = ((box.xmax - box.xmin) / 1000) * w;
        const bh = ((box.ymax - box.ymin) / 1000) * h;

        const isAnomaly = /anomal|unattended|weapon|tamper|intrusion|alert/i.test(
          `${box.label} ${box.attributes}`
        );
        ctx.strokeStyle = isAnomaly ? '#f43f5e' : '#22d3ee';
        ctx.lineWidth = Math.max(2, Math.round(w / 320));
        ctx.strokeRect(x, y, bw, bh);

        const caption = `${box.label} ${(box.confidence * 100).toFixed(0)}%`;
        ctx.font = '600 13px "JetBrains Mono", monospace';
        const textWidth = ctx.measureText(caption).width;
        ctx.fillStyle = isAnomaly ? 'rgba(190, 18, 60, 0.88)' : 'rgba(8, 14, 28, 0.85)';
        ctx.fillRect(x, Math.max(0, y - 22), textWidth + 12, 22);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(caption, x + 6, Math.max(15, y - 6));
      }
    },
    []
  );

  const startWebcam = async () => {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setWebcamActive(true);
      setCapturedPreviewUrl(null);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? `Camera access denied or unavailable: ${err.message}`
          : 'Unable to access browser webcam.'
      );
    }
  };

  const stopWebcam = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setWebcamActive(false);
  };

  const analyzeMutation = useMutation({
    mutationFn: async (params: {
      dataUrl: string;
      sourceType: 'webcam' | 'upload' | 'camera_snapshot';
      sourceElement: HTMLImageElement | HTMLVideoElement;
    }) => {
      const cameras = camerasQuery.data ?? [];
      const selectedCam = cameras.find((c) => c.id === selectedCameraId);
      const cameraName = selectedCam?.name ?? 'Local Browser Webcam';
      const zone = selectedCam?.zone ?? 'Live Inspection';

      const result = await apiClient.analyzeVisionFrame({
        imageBase64: params.dataUrl,
        cameraName,
        zone,
      });

      drawOverlayBoxes(params.sourceElement, result.detections);
      setActiveBoxes(result.detections);
      setLastSummary(result.summary);

      await platformService.recordVisionDetection({
        orgId,
        orgOwnerUid,
        actorUid,
        cameraId: selectedCam?.id ?? 'webcam_local',
        cameraName,
        zone,
        sourceType: params.sourceType,
        peopleCount: result.peopleCount,
        vehicleCount: result.vehicleCount,
        anomalyCount: result.anomalyCount,
        maxConfidence: result.maxConfidence,
        inferenceMs: result.inferenceMs,
        summary: result.summary,
        detections: result.detections,
      });

      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['vision-detections', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['security-events', orgId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Vision analysis failed.');
    },
  });

  const handleCaptureWebcam = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !webcamActive) return;
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 540;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setCapturedPreviewUrl(dataUrl);
    setErrorMsg(null);
    analyzeMutation.mutate({ dataUrl, sourceType: 'webcam', sourceElement: video });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setCapturedPreviewUrl(dataUrl);
      const img = new Image();
      img.onload = () => {
        drawOverlayBoxes(img, []);
        analyzeMutation.mutate({ dataUrl, sourceType: 'upload', sourceElement: img });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const detections = detectionsQuery.data ?? [];
  const totalPeople = detections.reduce((s, d) => s + d.peopleCount, 0);
  const totalVehicles = detections.reduce((s, d) => s + d.vehicleCount, 0);
  const totalAnomalies = detections.reduce((s, d) => s + d.anomalyCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
            Live Monitoring & Vision Intelligence
          </h1>
          <p className="text-sm text-slate-400">
            Phase 3 & 4 · Real-time webcam capture, Gemini bounding-box detection, and event correlation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!webcamActive ? (
            <Button size="sm" onClick={() => void startWebcam()} disabled={!canQueryLive}>
              <Camera className="h-4 w-4" />
              <span>Start Webcam</span>
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                onClick={handleCaptureWebcam}
                disabled={analyzeMutation.isPending || !canQueryLive}
              >
                <ScanSearch className="h-4 w-4" />
                <span>{analyzeMutation.isPending ? 'Analyzing Frame...' : 'Capture & Detect'}</span>
              </Button>
              <Button size="sm" variant="secondary" onClick={stopWebcam}>
                <VideoOff className="h-4 w-4" />
                <span>Stop Webcam</span>
              </Button>
            </>
          )}

          <label className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-slate-700 bg-[#0B1222] text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer">
            <Upload className="h-3.5 w-3.5" />
            <span>Analyze Frame Image</span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={!canQueryLive || analyzeMutation.isPending}
              onChange={handleFileUpload}
            />
          </label>
        </div>
      </div>

      <WorkspaceGuardNotice />

      {errorMsg && <NoticeBanner tone="error" title="Vision Inference Error" description={errorMsg} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Frames Analyzed</p>
            <p className="font-mono text-2xl font-semibold text-slate-100 tabular-nums">
              {detections.length}
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">People Detected (Cumulative)</p>
            <p className="font-mono text-2xl font-semibold text-cyan-300 tabular-nums">
              {totalPeople}
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Vehicles Detected</p>
            <p className="font-mono text-2xl font-semibold text-slate-100 tabular-nums">
              {totalVehicles}
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Correlated Anomalies</p>
            <p className="font-mono text-2xl font-semibold text-rose-400 tabular-nums">
              {totalAnomalies}
            </p>
          </SurfaceBody>
        </Surface>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Live Viewport & Bounding Box Canvas */}
        <Surface className="lg:col-span-2">
          <SurfaceHeader className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <SurfaceTitle>Optical Stream & Bounding-Box Canvas</SurfaceTitle>
              <SurfaceDescription>
                Captures live video frames or uploaded imagery and overlays normalized object detections.
              </SurfaceDescription>
            </div>
            <div className="w-56">
              <Label htmlFor="cam-select" className="sr-only">
                Camera Context
              </Label>
              <SelectField
                id="cam-select"
                value={selectedCameraId}
                onChange={(e) => setSelectedCameraId(e.target.value)}
                options={[
                  { value: 'ad-hoc-webcam', label: 'Local Browser Webcam' },
                  ...(camerasQuery.data ?? []).map((c) => ({
                    value: c.id,
                    label: `${c.name} (${c.zone})`,
                  })),
                ]}
              />
            </div>
          </SurfaceHeader>
          <SurfaceBody className="space-y-4">
            <div
              className={`grid gap-4 ${
                webcamActive && capturedPreviewUrl ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
              }`}
            >
              {webcamActive && (
                <div className="relative aspect-video w-full overflow-hidden rounded-md border border-slate-800 bg-[#050912]">
                  <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
                  <span className="absolute top-2 left-2 rounded bg-black/75 px-2 py-0.5 font-mono text-[11px] text-emerald-400">
                    LIVE FEED
                  </span>
                </div>
              )}

              <div
                className={`relative aspect-video w-full overflow-hidden rounded-md border border-slate-800 bg-[#050912] flex items-center justify-center ${
                  !capturedPreviewUrl && webcamActive ? 'hidden' : ''
                }`}
              >
                <canvas
                  ref={canvasRef}
                  className={capturedPreviewUrl ? 'w-full h-full object-contain' : 'hidden'}
                />
                {!webcamActive && !capturedPreviewUrl && (
                  <div className="text-center space-y-2 px-6">
                    <Eye className="h-8 w-8 text-slate-500 mx-auto" />
                    <p className="text-sm text-slate-300">No active frame in viewport</p>
                    <p className="text-xs text-slate-500">
                      Click Start Webcam or Analyze Frame Image to execute server-side Gemini object detection.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {lastSummary && (
              <div className="rounded-md border border-slate-800 bg-[#070D1A] p-3.5 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400 font-mono">
                  <span>Objects Detected: {activeBoxes.length}</span>
                  {frameQuality && (
                    <span>
                      Brightness: {frameQuality.brightness}/255 · Edge Sharpness: {frameQuality.sharpness}
                    </span>
                  )}
                </div>
                <p className="text-slate-200 leading-relaxed">{lastSummary}</p>
              </div>
            )}
          </SurfaceBody>
        </Surface>

        {/* Active Frame Detections Inspector */}
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Current Frame Detections</SurfaceTitle>
            <SurfaceDescription>
              Coordinates normalized to 0–1000 canvas space.
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody>
            {activeBoxes.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">
                Run Capture & Detect or upload a frame image to inspect object bounding boxes.
              </p>
            ) : (
              <div className="divide-y divide-slate-800/70">
                {activeBoxes.map((b, idx) => (
                  <div key={`${b.label}-${idx}`} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-100">{b.label}</span>
                      <span className="font-mono text-cyan-300 tabular-nums">
                        {(b.confidence * 100).toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{b.attributes || 'No secondary attributes'}</p>
                    <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                      Box [{b.ymin}, {b.xmin}, {b.ymax}, {b.xmax}]
                    </p>
                  </div>
                ))}
              </div>
            )}
          </SurfaceBody>
        </Surface>
      </div>

      {/* Persisted Detection History */}
      <Surface>
        <SurfaceHeader>
          <SurfaceTitle>Vision Detection Log</SurfaceTitle>
          <SurfaceDescription>
            Immutable frame inference audit stored in Firestore. Anomalies automatically emit Security Events.
          </SurfaceDescription>
        </SurfaceHeader>
        {detections.length === 0 ? (
          <SurfaceBody className="py-8 text-center text-xs text-slate-400">
            No detection records stored yet for this workspace.
          </SurfaceBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                  <th className="px-6 py-3 font-medium">Camera & Source</th>
                  <th className="px-4 py-3 font-medium">Summary</th>
                  <th className="px-4 py-3 font-medium text-right">People</th>
                  <th className="px-4 py-3 font-medium text-right">Vehicles</th>
                  <th className="px-4 py-3 font-medium text-right">Anomalies</th>
                  <th className="px-6 py-3 font-medium text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {detections.slice(0, 20).map((d) => (
                  <tr key={d.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3">
                      <div className="font-medium text-slate-100">{d.cameraName}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {d.sourceType} · {new Date(d.createdAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300 max-w-md">{d.summary}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-200">
                      {d.peopleCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-200">
                      {d.vehicleCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-rose-400">
                      {d.anomalyCount}
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-xs tabular-nums text-slate-400">
                      {d.inferenceMs} ms
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
