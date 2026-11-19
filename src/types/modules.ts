export type CameraStreamType = 'webcam' | 'rtsp' | 'onvif' | 'http_snapshot';
export type CameraStatus = 'active' | 'offline' | 'maintenance';

export interface CameraRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  name: string;
  zone: string;
  location: string;
  streamType: CameraStreamType;
  endpointMasked: string;
  status: CameraStatus;
  resolution: string;
  targetFps: number;
  lastLatencyMs: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DetectedObjectBox {
  label: string;
  confidence: number;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  attributes: string;
}

export interface VisionDetectionRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  cameraId: string;
  cameraName: string;
  sourceType: 'webcam' | 'upload' | 'camera_snapshot';
  peopleCount: number;
  vehicleCount: number;
  anomalyCount: number;
  maxConfidence: number;
  inferenceMs: number;
  summary: string;
  detections: DetectedObjectBox[];
  createdAt: string;
}

export interface VideoTimelineMarker {
  timestampSec: number;
  label: string;
  confidence: number;
  detail: string;
}

export interface VideoJobRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  fileName: string;
  fileSizeBytes: number;
  durationSec: number;
  resolution: string;
  framesSampled: number;
  avgBrightness: number;
  avgSharpness: number;
  status: 'completed' | 'failed';
  summary: string;
  detectedPlates: string[];
  timeline: VideoTimelineMarker[];
  inferenceMs: number;
  createdAt: string;
}

export type ClearanceLevel = 'standard' | 'elevated' | 'restricted' | 'executive';

export interface BiometricIdentityRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  fullName: string;
  employeeCode: string;
  department: string;
  clearanceLevel: ClearanceLevel;
  status: 'active' | 'suspended';
  faceEnrolled: boolean;
  voiceEnrolled: boolean;
  fingerprintEnrolled: boolean;
  faceDescriptorDigest: string;
  voiceDescriptorDigest: string;
  fingerprintDescriptorDigest: string;
  enrollmentNotes: string;
  createdAt: string;
  updatedAt: string;
}

export type VerificationOutcome = 'verified' | 'failed' | 'inconclusive';

export interface VerificationLogRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  identityId: string;
  identityName: string;
  checkpointName: string;
  modalitiesUsed: string[];
  faceScore: number | null;
  voiceScore: number | null;
  fingerprintScore: number | null;
  fusedScore: number;
  livenessPassed: boolean;
  outcome: VerificationOutcome;
  rationale: string;
  createdAt: string;
}

export type EventSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityEventRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  sourceModule: 'vision' | 'video' | 'identity' | 'camera' | 'manual';
  eventType: string;
  severity: EventSeverity;
  cameraId: string;
  zone: string;
  title: string;
  detail: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface RiskFactorItem {
  factor: string;
  weight: number;
  contribution: number;
}

export interface RiskAssessmentRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  targetLabel: string;
  zone: string;
  riskScore: number;
  severity: EventSeverity;
  factors: RiskFactorItem[];
  recommendation: string;
  createdAt: string;
}

export type IncidentStatus = 'open' | 'investigating' | 'contained' | 'resolved' | 'closed';

export interface IncidentRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  title: string;
  description: string;
  severity: EventSeverity;
  status: IncidentStatus;
  zone: string;
  linkedCameraId: string;
  linkedEventId: string;
  riskScore: number;
  assignedToUid: string;
  resolutionNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalystSessionRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  prompt: string;
  responseText: string;
  contextSnapshot: string;
  modelName: string;
  createdAt: string;
}

export interface EvidenceItemRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  caseNumber: string;
  title: string;
  sourceType: 'image_frame' | 'video_clip' | 'biometric_log' | 'incident_bundle';
  fileName: string;
  fileSizeBytes: number;
  sha256Digest: string;
  linkedIncidentId: string;
  custodyStatus: 'sealed' | 'under_review' | 'exported';
  custodyNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkRunRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  runName: string;
  datasetSource: 'live_verifications' | 'imported_scores';
  sampleCount: number;
  threshold: number;
  far: number;
  frr: number;
  tar: number;
  eer: number;
  auc: number;
  avgLatencyMs: number;
  createdAt: string;
}

export interface SecurityReportRecord {
  id: string;
  orgId: string;
  orgOwnerUid: string;
  createdByUid: string;
  title: string;
  reportType: 'executive' | 'compliance' | 'forensic' | 'biometric';
  summary: string;
  metricsSnapshot: {
    camerasTotal: number;
    camerasActive: number;
    detectionsTotal: number;
    verificationsTotal: number;
    incidentsOpen: number;
    evidenceSealed: number;
  };
  createdAt: string;
}
