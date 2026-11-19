import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Save } from 'lucide-react';
import { platformService } from '@/src/services/platformService';
import {
  evaluateBiometricMetrics,
  type LabeledScoreSample,
} from '@/src/lib/biometricsAndMetrics';
import { useWorkspaceContext, WorkspaceGuardNotice } from '@/src/components/WorkspaceGuardNotice';
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

export function ResearchLabPage() {
  const { orgId, orgOwnerUid, actorUid, actorEmail, canQueryLive } = useWorkspaceContext();
  const queryClient = useQueryClient();

  const [runName, setRunName] = React.useState('Multimodal Threshold Calibration');
  const [threshold, setThreshold] = React.useState(0.72);
  const [csvInput, setCsvInput] = React.useState('');
  const [feedback, setFeedback] = React.useState<string | null>(null);

  const verificationsQuery = useQuery({
    queryKey: ['verification-logs', orgId, actorUid],
    queryFn: () => platformService.listVerificationLogs(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });

  const detectionsQuery = useQuery({
    queryKey: ['vision-detections', orgId, actorUid],
    queryFn: () => platformService.listVisionDetections(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });

  const runsQuery = useQuery({
    queryKey: ['benchmark-runs', orgId, actorUid],
    queryFn: () => platformService.listBenchmarkRuns(orgId, actorUid, actorEmail),
    enabled: canQueryLive,
  });

  const parsedCsvSamples = React.useMemo<LabeledScoreSample[]>(() => {
    if (!csvInput.trim()) return [];
    const lines = csvInput.trim().split(/\r?\n/);
    const out: LabeledScoreSample[] = [];
    for (const line of lines) {
      const [sStr, labelStr] = line.split(',').map((p) => p.trim());
      const score = Number(sStr);
      if (Number.isNaN(score) || score < 0 || score > 1) continue;
      const isGenuine = labelStr === '1' || labelStr?.toLowerCase() === 'genuine' || labelStr?.toLowerCase() === 'true';
      out.push({ score, isGenuine });
    }
    return out;
  }, [csvInput]);

  const liveSamples = React.useMemo<LabeledScoreSample[]>(() => {
    return (verificationsQuery.data ?? []).map((v) => ({
      score: v.fusedScore,
      isGenuine: v.livenessPassed && v.outcome !== 'failed',
    }));
  }, [verificationsQuery.data]);

  const activeSamples = parsedCsvSamples.length > 0 ? parsedCsvSamples : liveSamples;
  const datasetSource = parsedCsvSamples.length > 0 ? 'imported_scores' : 'live_verifications';

  const metrics = React.useMemo(
    () => evaluateBiometricMetrics(activeSamples, threshold),
    [activeSamples, threshold]
  );

  const avgVisionLatency = React.useMemo(() => {
    const dets = detectionsQuery.data ?? [];
    if (dets.length === 0) return 0;
    return Math.round(dets.reduce((s, d) => s + d.inferenceMs, 0) / dets.length);
  }, [detectionsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      platformService.saveBenchmarkRun({
        orgId,
        orgOwnerUid,
        actorUid,
        runName: runName.trim() || 'Benchmark Run',
        datasetSource,
        sampleCount: activeSamples.length,
        threshold,
        far: metrics.far,
        frr: metrics.frr,
        tar: metrics.tar,
        eer: metrics.eer,
        auc: metrics.auc,
        avgLatencyMs: avgVisionLatency,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['benchmark-runs', orgId] });
      setFeedback('Benchmark snapshot saved to Firestore.');
    },
  });

  const runs = runsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
          Research & Biometric Evaluation Lab
        </h1>
        <p className="text-sm text-slate-400">
          Phase 8 · Real FAR, FRR, TAR, EER, and ROC/AUC computation over live verification logs or imported labeled scores
        </p>
      </div>

      <WorkspaceGuardNotice />

      {feedback && <NoticeBanner tone="success" title={feedback} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">Labeled Samples</p>
            <p className="font-mono text-2xl font-semibold text-slate-100 tabular-nums">
              {activeSamples.length}
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">FAR (False Accept)</p>
            <p className="font-mono text-2xl font-semibold text-rose-400 tabular-nums">
              {(metrics.far * 100).toFixed(2)}%
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">FRR (False Reject)</p>
            <p className="font-mono text-2xl font-semibold text-amber-300 tabular-nums">
              {(metrics.frr * 100).toFixed(2)}%
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">EER (Equal Error)</p>
            <p className="font-mono text-2xl font-semibold text-cyan-300 tabular-nums">
              {(metrics.eer * 100).toFixed(2)}%
            </p>
          </SurfaceBody>
        </Surface>
        <Surface>
          <SurfaceBody className="space-y-1">
            <p className="text-xs text-slate-400">ROC AUC / Avg Inference</p>
            <p className="font-mono text-xl font-semibold text-emerald-400 tabular-nums">
              {metrics.auc.toFixed(3)} · {avgVisionLatency}ms
            </p>
          </SurfaceBody>
        </Surface>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ROC SVG Visualization & Threshold Slider */}
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>ROC Curve & Decision Threshold Calibration</SurfaceTitle>
            <SurfaceDescription>
              Source: {datasetSource === 'imported_scores' ? 'Imported CSV Scores' : 'Live Workspace Verifications'}
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <Label htmlFor="roc-threshold">Decision Threshold (τ)</Label>
                <span className="font-mono text-cyan-300 tabular-nums">{threshold.toFixed(2)}</span>
              </div>
              <input
                id="roc-threshold"
                type="range"
                min={0.1}
                max={0.95}
                step={0.01}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>

            {activeSamples.length === 0 ? (
              <div className="py-12 text-center border border-slate-800 rounded-md bg-[#070D1A] space-y-2">
                <FlaskConical className="h-7 w-7 text-slate-500 mx-auto" />
                <p className="text-xs text-slate-400">
                  Run biometric verifications in Identity & Access or paste labeled CSV scores (score,1|0) to render the ROC curve.
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-slate-800 bg-[#070D1A] p-4">
                <svg viewBox="0 0 300 180" className="w-full h-48">
                  <line x1="30" y1="150" x2="280" y2="150" stroke="#334155" strokeWidth="1" />
                  <line x1="30" y1="15" x2="30" y2="150" stroke="#334155" strokeWidth="1" />
                  <line x1="30" y1="150" x2="280" y2="15" stroke="#475569" strokeDasharray="3 3" strokeWidth="1" />
                  <polyline
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth="2"
                    points={[...metrics.rocCurve]
                      .sort((a, b) => a.far - b.far)
                      .map((p) => `${30 + p.far * 250},${150 - p.tar * 135}`)
                      .join(' ')}
                  />
                  <circle
                    cx={30 + metrics.far * 250}
                    cy={150 - metrics.tar * 135}
                    r="4"
                    fill="#f43f5e"
                  />
                  <text x="145" y="170" fill="#94a3b8" fontSize="10">
                    FAR (False Accept Rate)
                  </text>
                  <text x="4" y="85" fill="#94a3b8" fontSize="10" transform="rotate(-90 12 85)">
                    TAR
                  </text>
                </svg>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Input
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder="Benchmark run title"
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={!canQueryLive || activeSamples.length === 0 || saveMutation.isPending}
              >
                <Save className="h-4 w-4" />
                <span>Save Snapshot</span>
              </Button>
            </div>
          </SurfaceBody>
        </Surface>

        {/* Labeled Score Importer */}
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Labeled Score Dataset (Optional CSV)</SurfaceTitle>
            <SurfaceDescription>
              Paste evaluation pairs (similarity_score, 1=genuine / 0=impostor) to benchmark offline score sets.
            </SurfaceDescription>
          </SurfaceHeader>
          <SurfaceBody className="space-y-3">
            <textarea
              rows={9}
              value={csvInput}
              onChange={(e) => setCsvInput(e.target.value)}
              placeholder={'0.92,1\n0.86,1\n0.79,1\n0.31,0\n0.44,0\n0.68,0'}
              className="w-full rounded-md border border-slate-800 bg-[#070D1A] px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
            />
            <div className="flex justify-between items-center text-xs text-slate-400">
              <span>Parsed rows: {parsedCsvSamples.length}</span>
              {csvInput && (
                <Button size="sm" variant="ghost" onClick={() => setCsvInput('')}>
                  Revert to Live Workspace Logs
                </Button>
              )}
            </div>
          </SurfaceBody>
        </Surface>
      </div>

      {runs.length > 0 && (
        <Surface>
          <SurfaceHeader>
            <SurfaceTitle>Saved Benchmark Snapshots</SurfaceTitle>
          </SurfaceHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-slate-400">
                  <th className="px-6 py-3 font-medium">Run Name</th>
                  <th className="px-4 py-3 font-medium text-right">Samples</th>
                  <th className="px-4 py-3 font-medium text-right">Threshold</th>
                  <th className="px-4 py-3 font-medium text-right">FAR</th>
                  <th className="px-4 py-3 font-medium text-right">FRR</th>
                  <th className="px-4 py-3 font-medium text-right">EER</th>
                  <th className="px-6 py-3 font-medium text-right">AUC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="px-6 py-3 text-slate-100">{r.runName}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{r.sampleCount}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{r.threshold.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{(r.far * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{(r.frr * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{(r.eer * 100).toFixed(2)}%</td>
                    <td className="px-6 py-3 text-right font-mono text-xs tabular-nums text-cyan-300">{r.auc.toFixed(3)}</td>
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
