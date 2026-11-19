import { auth } from '@/src/services/firebase';
import type { DetectedObjectBox, VideoTimelineMarker } from '@/src/types/modules';

async function getBearerHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required before invoking server API.');
  }
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const headers = await getBearerHeaders();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
  } & T;

  if (!res.ok) {
    throw new Error(payload.error?.message || `API request failed (${res.status})`);
  }
  return payload;
}

export const apiClient = {
  probeCamera(params: { streamType: string; endpoint: string }) {
    return postJson<{
      reachable: boolean;
      status: 'active' | 'offline';
      latencyMs: number;
      detail: string;
    }>('/api/v1/cameras/probe', params);
  },

  analyzeVisionFrame(params: {
    imageBase64: string;
    cameraName: string;
    zone: string;
  }) {
    return postJson<{
      summary: string;
      peopleCount: number;
      vehicleCount: number;
      anomalyCount: number;
      maxConfidence: number;
      inferenceMs: number;
      detections: DetectedObjectBox[];
    }>('/api/v1/vision/analyze-frame', params);
  },

  analyzeVideoKeyframes(params: {
    fileName: string;
    durationSec: number;
    frames: Array<{ timestampSec: number; imageBase64: string }>;
  }) {
    return postJson<{
      summary: string;
      detectedPlates: string[];
      timeline: VideoTimelineMarker[];
      inferenceMs: number;
    }>('/api/v1/video/analyze', params);
  },

  verifyMultimodalBiometrics(params: {
    claimedName: string;
    enrolledModalities: { face: boolean; voice: boolean; fingerprint: boolean };
    faceSampleBase64?: string;
    voiceSampleBase64?: string;
    fingerprintSampleBase64?: string;
    faceDigestMatch?: number | null;
    voiceDigestMatch?: number | null;
    fingerprintDigestMatch?: number | null;
  }) {
    return postJson<{
      faceScore: number | null;
      voiceScore: number | null;
      fingerprintScore: number | null;
      fusedScore: number;
      livenessPassed: boolean;
      outcome: 'verified' | 'failed' | 'inconclusive';
      rationale: string;
    }>('/api/v1/identity/verify-multimodal', params);
  },

  queryAiAnalyst(params: { prompt: string; contextSummary: string }) {
    return postJson<{
      recommendation: string;
      model: string;
      advisoryLabel: string;
    }>('/api/v1/analyst/query', params);
  },

  computeEvidenceSha256(params: { payloadBase64?: string; textPayload?: string }) {
    return postJson<{
      sha256: string;
      byteLength: number;
      computedAt: string;
    }>('/api/v1/evidence/hash', params);
  },
};
