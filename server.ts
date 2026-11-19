import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

interface FirebaseConfigFile {
  projectId?: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseConfig(): FirebaseConfigFile {
  const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as FirebaseConfigFile;
  } catch {
    return {};
  }
}

const firebaseConfig = loadFirebaseConfig();
const hasValidFirebaseProject =
  Boolean(firebaseConfig.projectId) &&
  firebaseConfig.projectId !== 'remixed-project-id';

if (hasValidFirebaseProject) {
  if (!getApps().length) {
    initializeApp({ projectId: firebaseConfig.projectId });
  }
}

interface AuthenticatedRequest extends Request {
  authUser?: DecodedIdToken;
}

async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!hasValidFirebaseProject) {
    res.status(503).json({
      error: {
        code: 'FIREBASE_NOT_CONFIGURED',
        message: 'Firebase project configuration is missing or uses a placeholder.',
      },
    });
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Missing Bearer Firebase ID token.',
      },
    });
    return;
  }

  const idToken = header.slice('Bearer '.length).trim();
  try {
    const app = getApp();
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.email_verified) {
      res.status(403).json({
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'A verified Google account email is required.',
        },
      });
      return;
    }
    req.authUser = decoded;
    next();
  } catch {
    res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Firebase ID token is invalid or expired.',
      },
    });
  }
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function stripDataUrlPrefix(base64OrDataUrl: string): { mimeType: string; data: string } {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(base64OrDataUrl.trim());
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: 'image/jpeg', data: base64OrDataUrl.trim() };
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === 'metadata.google.internal' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  if (net.isIPv4(lower)) {
    const parts = lower.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  if (net.isIPv6(lower)) {
    if (lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) {
      return true;
    }
  }
  return false;
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // ---------------------------------------------------------------------------
  // Health & Auth Verification
  // ---------------------------------------------------------------------------
  app.get('/api/v1/health/live', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'VisionX AI Server API',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/health/ready', (_req: Request, res: Response) => {
    const geminiConfigured = Boolean(getGeminiClient());
    res.json({
      status: hasValidFirebaseProject ? 'ready' : 'degraded',
      checks: {
        firebase_project_configured: hasValidFirebaseProject,
        firebase_project_id: firebaseConfig.projectId ?? null,
        firestore_database_id: firebaseConfig.firestoreDatabaseId ?? null,
        gemini_api_configured: geminiConfigured,
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.post(
    '/api/v1/auth/verify',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const user = req.authUser!;
      res.json({
        verified: true,
        uid: user.uid,
        email: user.email ?? null,
        email_verified: Boolean(user.email_verified),
      });
    }
  );

  // ---------------------------------------------------------------------------
  // Phase 3: SSRF-Safe Camera Endpoint Diagnostics
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/cameras/probe',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const { streamType, endpoint } = (req.body ?? {}) as {
        streamType?: string;
        endpoint?: string;
      };

      if (!endpoint || typeof endpoint !== 'string') {
        res.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: 'Camera endpoint URI is required.' },
        });
        return;
      }

      if (streamType === 'webcam') {
        res.json({
          reachable: true,
          status: 'active',
          latencyMs: 4,
          detail: 'Browser MediaDevices WebRTC/Webcam adapter ready for local frame capture.',
        });
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(endpoint);
      } catch {
        res.status(422).json({
          error: { code: 'INVALID_URI', message: 'Endpoint must be a valid URI.' },
        });
        return;
      }

      if (!['http:', 'https:', 'rtsp:'].includes(parsedUrl.protocol)) {
        res.status(422).json({
          error: {
            code: 'UNSUPPORTED_PROTOCOL',
            message: 'Only http://, https://, rtsp://, or browser webcam endpoints are allowed.',
          },
        });
        return;
      }

      if (isPrivateOrBlockedHost(parsedUrl.hostname)) {
        res.status(403).json({
          error: {
            code: 'SSRF_BLOCKED',
            message:
              'Private, loopback, and cloud metadata IP ranges are blocked by SSRF policy on cloud probes.',
          },
        });
        return;
      }

      if (parsedUrl.protocol === 'rtsp:') {
        res.json({
          reachable: false,
          status: 'offline',
          latencyMs: 0,
          detail:
            'RTSP streams require a local Python/OpenCV worker bridge; cloud serverless probe validated URI syntax only.',
        });
        return;
      }

      const started = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);
        const upstream = await fetch(parsedUrl.toString(), {
          method: 'HEAD',
          redirect: 'error',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const latencyMs = Math.max(1, Date.now() - started);
        res.json({
          reachable: upstream.ok,
          status: upstream.ok ? 'active' : 'offline',
          latencyMs,
          detail: `HTTP ${upstream.status} ${upstream.statusText} (${latencyMs}ms)`,
        });
      } catch (err) {
        const latencyMs = Math.max(1, Date.now() - started);
        res.json({
          reachable: false,
          status: 'offline',
          latencyMs,
          detail: err instanceof Error ? err.message : 'Endpoint did not respond within timeout.',
        });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Phase 3 & 4: Vision Frame Object Detection & Bounding Box Analysis
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/vision/analyze-frame',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: {
            code: 'GEMINI_KEY_MISSING',
            message: 'GEMINI_API_KEY is not configured in Settings > Secrets.',
          },
        });
        return;
      }

      const { imageBase64, cameraName, zone } = (req.body ?? {}) as {
        imageBase64?: string;
        cameraName?: string;
        zone?: string;
      };

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(422).json({
          error: { code: 'VALIDATION_ERROR', message: 'imageBase64 frame payload is required.' },
        });
        return;
      }

      const { mimeType, data } = stripDataUrlPrefix(imageBase64);
      const started = Date.now();

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              { inlineData: { mimeType, data } },
              {
                text: `Analyze this surveillance frame from camera "${cameraName || 'Camera Feed'}" in zone "${zone || 'Perimeter'}". Identify visible people, vehicles, bags/objects, license plates, or security anomalies (e.g., unattended baggage, tailgating, restricted entry, PPE violation, tampering). Return bounding boxes in normalized 0-1000 coordinates [ymin, xmin, ymax, xmax]. Only report what is genuinely visible in the image.`,
              },
            ],
          },
          config: {
            systemInstruction:
              'You are a precision computer-vision detector for VisionX AI. Report only genuine objects visible in the provided frame. Never invent objects.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING },
                peopleCount: { type: Type.INTEGER },
                vehicleCount: { type: Type.INTEGER },
                anomalyCount: { type: Type.INTEGER },
                detections: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      confidence: { type: Type.NUMBER },
                      ymin: { type: Type.INTEGER },
                      xmin: { type: Type.INTEGER },
                      ymax: { type: Type.INTEGER },
                      xmax: { type: Type.INTEGER },
                      attributes: { type: Type.STRING },
                    },
                  },
                },
              },
            },
          },
        });

        const inferenceMs = Math.max(1, Date.now() - started);
        const parsed = JSON.parse((response.text ?? '{}').trim()) as {
          summary?: string;
          peopleCount?: number;
          vehicleCount?: number;
          anomalyCount?: number;
          detections?: Array<{
            label?: string;
            confidence?: number;
            ymin?: number;
            xmin?: number;
            ymax?: number;
            xmax?: number;
            attributes?: string;
          }>;
        };

        const detections = (parsed.detections ?? []).slice(0, 50).map((d) => ({
          label: String(d.label || 'object').slice(0, 60),
          confidence: Math.min(1, Math.max(0, Number(d.confidence ?? 0.5))),
          ymin: Math.min(1000, Math.max(0, Math.round(Number(d.ymin ?? 0)))),
          xmin: Math.min(1000, Math.max(0, Math.round(Number(d.xmin ?? 0)))),
          ymax: Math.min(1000, Math.max(0, Math.round(Number(d.ymax ?? 0)))),
          xmax: Math.min(1000, Math.max(0, Math.round(Number(d.xmax ?? 0)))),
          attributes: String(d.attributes || '').slice(0, 140),
        }));

        const maxConfidence = detections.reduce((m, d) => Math.max(m, d.confidence), 0);

        res.json({
          summary: String(parsed.summary || 'Frame analyzed successfully.').slice(0, 600),
          peopleCount: Math.max(0, Math.round(Number(parsed.peopleCount ?? 0))),
          vehicleCount: Math.max(0, Math.round(Number(parsed.vehicleCount ?? 0))),
          anomalyCount: Math.max(0, Math.round(Number(parsed.anomalyCount ?? 0))),
          maxConfidence,
          inferenceMs,
          detections,
        });
      } catch (err) {
        res.status(502).json({
          error: {
            code: 'GEMINI_VISION_ERROR',
            message: err instanceof Error ? err.message : 'Vision frame analysis failed.',
          },
        });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Phase 4: Video Intelligence Keyframe Timeline & ALPR Analysis
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/video/analyze',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: {
            code: 'GEMINI_KEY_MISSING',
            message: 'GEMINI_API_KEY is not configured in Settings > Secrets.',
          },
        });
        return;
      }

      const { fileName, durationSec, frames } = (req.body ?? {}) as {
        fileName?: string;
        durationSec?: number;
        frames?: Array<{ timestampSec: number; imageBase64: string }>;
      };

      if (!Array.isArray(frames) || frames.length === 0 || frames.length > 10) {
        res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Provide between 1 and 10 sampled video keyframes.',
          },
        });
        return;
      }

      const started = Date.now();
      const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> =
        [];

      for (const f of frames) {
        const stripped = stripDataUrlPrefix(f.imageBase64);
        parts.push({ text: `Keyframe at ${Number(f.timestampSec).toFixed(1)}s:` });
        parts.push({ inlineData: { mimeType: stripped.mimeType, data: stripped.data } });
      }
      parts.push({
        text: `Perform a forensic video investigation across these ${frames.length} keyframes from "${fileName || 'uploaded_video'}" (duration ${Number(durationSec ?? 0).toFixed(1)}s). Report chronological timeline markers, tracked subjects/vehicles, any clearly readable vehicle license plates (ALPR), and overall investigative summary.`,
      });

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: { parts },
          config: {
            systemInstruction:
              'You are a forensic video analyst for VisionX AI. Only report objects, events, and license plates clearly visible in the supplied keyframes.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING },
                detectedPlates: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                timeline: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      timestampSec: { type: Type.NUMBER },
                      label: { type: Type.STRING },
                      confidence: { type: Type.NUMBER },
                      detail: { type: Type.STRING },
                    },
                  },
                },
              },
            },
          },
        });

        const inferenceMs = Math.max(1, Date.now() - started);
        const parsed = JSON.parse((response.text ?? '{}').trim()) as {
          summary?: string;
          detectedPlates?: string[];
          timeline?: Array<{
            timestampSec?: number;
            label?: string;
            confidence?: number;
            detail?: string;
          }>;
        };

        res.json({
          summary: String(parsed.summary || 'Video investigation completed.').slice(0, 1000),
          detectedPlates: (parsed.detectedPlates ?? [])
            .map((p) => String(p).trim().slice(0, 32))
            .filter(Boolean)
            .slice(0, 30),
          timeline: (parsed.timeline ?? []).slice(0, 50).map((t) => ({
            timestampSec: Math.max(0, Number(t.timestampSec ?? 0)),
            label: String(t.label || 'Event').slice(0, 80),
            confidence: Math.min(1, Math.max(0, Number(t.confidence ?? 0.5))),
            detail: String(t.detail || '').slice(0, 220),
          })),
          inferenceMs,
        });
      } catch (err) {
        res.status(502).json({
          error: {
            code: 'GEMINI_VIDEO_ERROR',
            message: err instanceof Error ? err.message : 'Video analysis failed.',
          },
        });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Phase 5: Multimodal Biometric Verification & Liveness Inspection
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/identity/verify-multimodal',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: {
            code: 'GEMINI_KEY_MISSING',
            message: 'GEMINI_API_KEY is not configured in Settings > Secrets.',
          },
        });
        return;
      }

      const {
        claimedName,
        enrolledModalities,
        faceSampleBase64,
        voiceSampleBase64,
        fingerprintSampleBase64,
        faceDigestMatch,
        voiceDigestMatch,
        fingerprintDigestMatch,
      } = (req.body ?? {}) as {
        claimedName?: string;
        enrolledModalities?: { face: boolean; voice: boolean; fingerprint: boolean };
        faceSampleBase64?: string;
        voiceSampleBase64?: string;
        fingerprintSampleBase64?: string;
        faceDigestMatch?: number | null;
        voiceDigestMatch?: number | null;
        fingerprintDigestMatch?: number | null;
      };

      if (!faceSampleBase64 && !voiceSampleBase64 && !fingerprintSampleBase64) {
        res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Submit at least one biometric sample (face, voice, or fingerprint).',
          },
        });
        return;
      }

      const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> =
        [];
      if (faceSampleBase64) {
        const f = stripDataUrlPrefix(faceSampleBase64);
        parts.push({ text: 'Submitted Face Probe Image:' });
        parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
      }
      if (voiceSampleBase64) {
        const v = stripDataUrlPrefix(voiceSampleBase64);
        parts.push({ text: 'Submitted Voice Probe Audio:' });
        parts.push({ inlineData: { mimeType: v.mimeType, data: v.data } });
      }
      if (fingerprintSampleBase64) {
        const fp = stripDataUrlPrefix(fingerprintSampleBase64);
        parts.push({ text: 'Submitted Fingerprint Probe Image:' });
        parts.push({ inlineData: { mimeType: fp.mimeType, data: fp.data } });
      }

      parts.push({
        text: [
          `Evaluate these submitted biometric samples for claimed subject "${claimedName || 'Subject'}".`,
          `Enrolled modalities: face=${Boolean(enrolledModalities?.face)}, voice=${Boolean(enrolledModalities?.voice)}, fingerprint=${Boolean(enrolledModalities?.fingerprint)}.`,
          `Local template perceptual/hash similarity hints: face=${faceDigestMatch ?? 'N/A'}, voice=${voiceDigestMatch ?? 'N/A'}, fingerprint=${fingerprintDigestMatch ?? 'N/A'}.`,
          'Assess: (1) Whether the face image appears to be a live genuine human camera capture vs a printed photo/screen spoof/blank/non-face; (2) Whether the voice clip contains clear human speech; (3) Whether the fingerprint image shows clear ridge/minutiae patterns; (4) Return realistic modality quality/confidence scores in [0,1] and concise rationale.',
        ].join('\n'),
      });

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: { parts },
          config: {
            systemInstruction:
              'You are a biometric liveness and quality inspector for VisionX AI. Be strict: reject blank frames, non-human subjects, screen-replay artifacts, or missing biometric features.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                livenessPassed: { type: Type.BOOLEAN },
                faceQuality: { type: Type.NUMBER },
                voiceQuality: { type: Type.NUMBER },
                fingerprintQuality: { type: Type.NUMBER },
                rationale: { type: Type.STRING },
              },
            },
          },
        });

        const parsed = JSON.parse((response.text ?? '{}').trim()) as {
          livenessPassed?: boolean;
          faceQuality?: number;
          voiceQuality?: number;
          fingerprintQuality?: number;
          rationale?: string;
        };

        const faceScore = faceSampleBase64
          ? Number(
              (
                0.55 * Math.min(1, Math.max(0, Number(parsed.faceQuality ?? 0.5))) +
                0.45 * (faceDigestMatch ?? 0.65)
              ).toFixed(3)
            )
          : null;
        const voiceScore = voiceSampleBase64
          ? Number(
              (
                0.6 * Math.min(1, Math.max(0, Number(parsed.voiceQuality ?? 0.5))) +
                0.4 * (voiceDigestMatch ?? 0.65)
              ).toFixed(3)
            )
          : null;
        const fingerprintScore = fingerprintSampleBase64
          ? Number(
              (
                0.55 * Math.min(1, Math.max(0, Number(parsed.fingerprintQuality ?? 0.5))) +
                0.45 * (fingerprintDigestMatch ?? 0.65)
              ).toFixed(3)
            )
          : null;

        // Weighted multimodal fusion (normalized across provided modalities)
        let weightedSum = 0;
        let totalWeight = 0;
        if (faceScore !== null) {
          weightedSum += 0.45 * faceScore;
          totalWeight += 0.45;
        }
        if (voiceScore !== null) {
          weightedSum += 0.3 * voiceScore;
          totalWeight += 0.3;
        }
        if (fingerprintScore !== null) {
          weightedSum += 0.25 * fingerprintScore;
          totalWeight += 0.25;
        }

        const fusedScore = totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(3)) : 0;
        const livenessPassed = Boolean(parsed.livenessPassed);

        let outcome: 'verified' | 'failed' | 'inconclusive' = 'inconclusive';
        if (!livenessPassed || fusedScore < 0.52) {
          outcome = 'failed';
        } else if (fusedScore >= 0.72) {
          outcome = 'verified';
        } else {
          outcome = 'inconclusive';
        }

        res.json({
          faceScore,
          voiceScore,
          fingerprintScore,
          fusedScore,
          livenessPassed,
          outcome,
          rationale: String(parsed.rationale || 'Multimodal biometric verification evaluated.').slice(
            0,
            600
          ),
        });
      } catch (err) {
        res.status(502).json({
          error: {
            code: 'GEMINI_BIOMETRIC_ERROR',
            message: err instanceof Error ? err.message : 'Biometric verification failed.',
          },
        });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Phase 7: Grounded AI Security Analyst
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/analyst/query',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: {
            code: 'GEMINI_KEY_MISSING',
            message:
              'GEMINI_API_KEY is not configured in server secrets. Configure it in Settings > Secrets.',
          },
        });
        return;
      }

      const { prompt, contextSummary } = (req.body ?? {}) as {
        prompt?: string;
        contextSummary?: string;
      };

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 2) {
        res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A non-empty analyst prompt is required.',
          },
        });
        return;
      }

      try {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: [
            'Authorized Security Context:',
            contextSummary?.trim() || 'No operational records currently present in workspace.',
            '',
            `Operator Question: ${prompt.trim()}`,
          ].join('\n'),
          config: {
            systemInstruction:
              'You are the VisionX AI Security Analyst. Strictly analyze only the supplied authorized records and counts. Cite specific camera names, event IDs, verification outcomes, risk scores, or incident IDs from the supplied context. Never fabricate events, biometrics, or detections. Clearly label conclusions as recommendations for human review.',
          },
        });

        res.json({
          recommendation: response.text ?? '',
          model: 'gemini-4-hydrogen',
          advisoryLabel: 'AI-Generated Recommendation · Requires Human Review',
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Gemini upstream request failed.';
        res.status(502).json({
          error: {
            code: 'GEMINI_UPSTREAM_ERROR',
            message,
          },
        });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Phase 8: Server-Side SHA-256 Digital Evidence Digest
  // ---------------------------------------------------------------------------
  app.post(
    '/api/v1/evidence/hash',
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const { payloadBase64, textPayload } = (req.body ?? {}) as {
        payloadBase64?: string;
        textPayload?: string;
      };

      if (!payloadBase64 && !textPayload) {
        res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Provide payloadBase64 or textPayload to compute SHA-256 digest.',
          },
        });
        return;
      }

      const buffer = payloadBase64
        ? Buffer.from(stripDataUrlPrefix(payloadBase64).data, 'base64')
        : Buffer.from(String(textPayload), 'utf-8');

      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      res.json({
        sha256,
        byteLength: buffer.byteLength,
        computedAt: new Date().toISOString(),
      });
    }
  );

  // ---------------------------------------------------------------------------
  // Vite Middleware (Dev) / Static Dist Serving (Prod)
  // ---------------------------------------------------------------------------
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VisionX AI server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
