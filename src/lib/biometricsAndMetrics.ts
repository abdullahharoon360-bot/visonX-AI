import type { EventSeverity, RiskFactorItem } from '@/src/types/modules';

export async function sha256HexFromBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256HexFromText(text: string): Promise<string> {
  const enc = new TextEncoder();
  return sha256HexFromBuffer(enc.encode(text).buffer);
}

/**
 * Computes real perceptual brightness (0-255) and Laplacian edge sharpness variance
 * directly from an HTMLCanvasElement's pixel buffer.
 */
export function computeCanvasQualityMetrics(canvas: HTMLCanvasElement): {
  brightness: number;
  sharpness: number;
} {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width < 3 || canvas.height < 3) {
    return { brightness: 0, sharpness: 0 };
  }

  const w = Math.min(canvas.width, 320);
  const h = Math.min(canvas.height, 240);
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = w;
  tmpCanvas.height = h;
  const tmpCtx = tmpCanvas.getContext('2d');
  if (!tmpCtx) return { brightness: 0, sharpness: 0 };

  tmpCtx.drawImage(canvas, 0, 0, w, h);
  const { data } = tmpCtx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  let lumSum = 0;
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    const g = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    gray[i] = g;
    lumSum += g;
  }

  let lapSum = 0;
  let lapSqSum = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = gray[y * w + x];
      const lap =
        gray[(y - 1) * w + x] +
        gray[(y + 1) * w + x] +
        gray[y * w + (x - 1)] +
        gray[y * w + (x + 1)] -
        4 * c;
      lapSum += lap;
      lapSqSum += lap * lap;
      count++;
    }
  }

  const meanLap = count > 0 ? lapSum / count : 0;
  const variance = count > 0 ? Math.max(0, lapSqSum / count - meanLap * meanLap) : 0;

  return {
    brightness: Number((lumSum / (w * h)).toFixed(1)),
    sharpness: Number(variance.toFixed(1)),
  };
}

/**
 * Computes a deterministic 64-bit average perceptual hash (aHash) hex string
 * from an image data URL so enrolled vs probe images can be compared locally.
 */
export async function computeImagePerceptualHash(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve('0000000000000000');
        return;
      }
      ctx.drawImage(img, 0, 0, 8, 8);
      const { data } = ctx.getImageData(0, 0, 8, 8);
      const grays: number[] = [];
      for (let i = 0; i < 64; i++) {
        const idx = i * 4;
        grays.push(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
      }
      const avg = grays.reduce((a, b) => a + b, 0) / 64;
      let bits = '';
      for (const g of grays) {
        bits += g >= avg ? '1' : '0';
      }
      let hex = '';
      for (let i = 0; i < 64; i += 4) {
        hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
      }
      resolve(hex);
    };
    img.onerror = () => resolve('0000000000000000');
    img.src = dataUrl;
  });
}

export function compareHexHashes(hexA: string, hexB: string): number {
  if (!hexA || !hexB || hexA.length !== hexB.length) return 0.5;
  let matchingBits = 0;
  const totalBits = hexA.length * 4;
  for (let i = 0; i < hexA.length; i++) {
    const a = parseInt(hexA[i], 16);
    const b = parseInt(hexB[i], 16);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    let x = a ^ b;
    let diff = 0;
    while (x > 0) {
      diff += x & 1;
      x >>= 1;
    }
    matchingBits += 4 - diff;
  }
  return Number((matchingBits / totalBits).toFixed(3));
}

export function computeDeterministicRiskScore(inputs: {
  failedVerifications24h: number;
  unacknowledgedHighEvents: number;
  visionAnomalies: number;
  offlineCameras: number;
  zoneSensitivity: 'standard' | 'restricted' | 'critical';
}): {
  riskScore: number;
  severity: EventSeverity;
  factors: RiskFactorItem[];
  recommendation: string;
} {
  const zoneMult =
    inputs.zoneSensitivity === 'critical' ? 1.25 : inputs.zoneSensitivity === 'restricted' ? 1.1 : 1.0;

  const failedFactor = Math.min(35, inputs.failedVerifications24h * 12);
  const eventFactor = Math.min(30, inputs.unacknowledgedHighEvents * 10);
  const anomalyFactor = Math.min(20, inputs.visionAnomalies * 8);
  const cameraFactor = Math.min(15, inputs.offlineCameras * 5);

  const rawTotal = (failedFactor + eventFactor + anomalyFactor + cameraFactor) * zoneMult;
  const riskScore = Math.min(100, Math.round(rawTotal));

  let severity: EventSeverity = 'low';
  if (riskScore >= 75) severity = 'critical';
  else if (riskScore >= 50) severity = 'high';
  else if (riskScore >= 25) severity = 'medium';

  const factors: RiskFactorItem[] = [
    { factor: 'Failed Biometric Verifications', weight: 0.35, contribution: failedFactor },
    { factor: 'Unacknowledged High/Critical Events', weight: 0.3, contribution: eventFactor },
    { factor: 'Vision Anomaly Detections', weight: 0.2, contribution: anomalyFactor },
    { factor: 'Offline Surveillance Coverage', weight: 0.15, contribution: cameraFactor },
  ];

  const recommendation =
    severity === 'critical'
      ? 'Immediate escalation recommended: lock checkpoint access, dispatch response team, and preserve video evidence.'
      : severity === 'high'
        ? 'Escalate to Security Incident, review failed biometric logs, and verify camera blind spots.'
        : severity === 'medium'
          ? 'Monitor correlated zone alerts and acknowledge resolved telemetry items.'
          : 'Posture nominal. Continue routine checkpoint monitoring.';

  return { riskScore, severity, factors, recommendation };
}

export interface LabeledScoreSample {
  score: number;
  isGenuine: boolean;
}

export interface RocPoint {
  threshold: number;
  far: number;
  tar: number;
  frr: number;
}

export function evaluateBiometricMetrics(
  samples: LabeledScoreSample[],
  threshold: number
): {
  far: number;
  frr: number;
  tar: number;
  eer: number;
  auc: number;
  rocCurve: RocPoint[];
} {
  const genuine = samples.filter((s) => s.isGenuine);
  const impostor = samples.filter((s) => !s.isGenuine);

  const calcAt = (t: number) => {
    const falseAccepts = impostor.filter((s) => s.score >= t).length;
    const falseRejects = genuine.filter((s) => s.score < t).length;
    const far = impostor.length > 0 ? falseAccepts / impostor.length : 0;
    const frr = genuine.length > 0 ? falseRejects / genuine.length : 0;
    const tar = 1 - frr;
    return { far, frr, tar };
  };

  const current = calcAt(threshold);

  const rocCurve: RocPoint[] = [];
  let minGap = Infinity;
  let eer = 0;

  for (let i = 0; i <= 40; i++) {
    const t = Number((i / 40).toFixed(3));
    const { far, frr, tar } = calcAt(t);
    rocCurve.push({ threshold: t, far, tar, frr });
    const gap = Math.abs(far - frr);
    if (gap < minGap) {
      minGap = gap;
      eer = (far + frr) / 2;
    }
  }

  // Trapezoidal AUC over sorted (FAR, TAR)
  const sorted = [...rocCurve].sort((a, b) => a.far - b.far);
  let auc = 0;
  for (let i = 1; i < sorted.length; i++) {
    const dx = sorted[i].far - sorted[i - 1].far;
    const avgY = (sorted[i].tar + sorted[i - 1].tar) / 2;
    auc += dx * avgY;
  }

  return {
    far: Number(current.far.toFixed(4)),
    frr: Number(current.frr.toFixed(4)),
    tar: Number(current.tar.toFixed(4)),
    eer: Number(eer.toFixed(4)),
    auc: Number(Math.min(1, Math.max(0, auc)).toFixed(4)),
    rocCurve,
  };
}
