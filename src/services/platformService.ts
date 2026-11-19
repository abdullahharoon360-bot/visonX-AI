import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, firebaseProjectInfo } from '@/src/services/firebase';
import { handleFirestoreError, OperationType } from '@/src/lib/firestoreError';
import type {
  AnalystSessionRecord,
  BenchmarkRunRecord,
  BiometricIdentityRecord,
  CameraRecord,
  CameraStatus,
  CameraStreamType,
  ClearanceLevel,
  DetectedObjectBox,
  EventSeverity,
  EvidenceItemRecord,
  IncidentRecord,
  IncidentStatus,
  RiskAssessmentRecord,
  RiskFactorItem,
  SecurityEventRecord,
  SecurityReportRecord,
  VerificationLogRecord,
  VerificationOutcome,
  VideoJobRecord,
  VideoTimelineMarker,
  VisionDetectionRecord,
} from '@/src/types/modules';

function safeId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`.slice(0, 64);
}

function tsToIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function isBootstrappedAdmin(email: string): boolean {
  return firebaseProjectInfo.bootstrappedAdminEmails.includes(email.toLowerCase());
}

async function listOrgScopedDocs(
  orgId: string,
  subcollection: string,
  actorUid: string,
  actorEmail: string
) {
  const path = `organizations/${orgId}/${subcollection}`;
  try {
    const baseRef = collection(db, 'organizations', orgId, subcollection);
    const snap = isBootstrappedAdmin(actorEmail)
      ? await getDocs(baseRef)
      : await getDocs(query(baseRef, where('createdByUid', '==', actorUid)));
    return snap.docs.map((d) => d.data());
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export const platformService = {
  // ---------------------------------------------------------------------------
  // Cameras
  // ---------------------------------------------------------------------------
  async listCameras(orgId: string, actorUid: string, actorEmail: string): Promise<CameraRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'cameras', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        name: String(d.name),
        zone: String(d.zone),
        location: String(d.location),
        streamType: d.streamType as CameraStreamType,
        endpointMasked: String(d.endpointMasked),
        status: d.status as CameraStatus,
        resolution: String(d.resolution),
        targetFps: Number(d.targetFps),
        lastLatencyMs: d.lastLatencyMs == null ? null : Number(d.lastLatencyMs),
        lastCheckedAt: d.lastCheckedAt ? String(d.lastCheckedAt) : null,
        createdAt: tsToIso(d.createdAt),
        updatedAt: tsToIso(d.updatedAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createCamera(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
    name: string;
    zone: string;
    location: string;
    streamType: CameraStreamType;
    endpointMasked: string;
    resolution: string;
    targetFps: number;
  }): Promise<string> {
    const cameraId = safeId('cam');
    const logId = safeId('log');
    const batch = writeBatch(db);

    batch.set(doc(db, 'organizations', params.orgId, 'cameras', cameraId), {
      id: cameraId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      name: params.name.trim().slice(0, 120),
      zone: params.zone.trim().slice(0, 80),
      location: params.location.trim().slice(0, 160),
      streamType: params.streamType,
      endpointMasked: params.endpointMasked.trim().slice(0, 255),
      status: params.streamType === 'webcam' ? 'active' : 'offline',
      resolution: params.resolution.trim().slice(0, 32),
      targetFps: Math.min(120, Math.max(1, Math.trunc(params.targetFps))),
      lastLatencyMs: null,
      lastCheckedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'camera.registered',
      resourceType: 'camera',
      resourceId: cameraId,
      summary: `Registered camera ${params.name} in ${params.zone}`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      return cameraId;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `organizations/${params.orgId}/cameras/${cameraId}`);
    }
  },

  async updateCameraHealth(params: {
    orgId: string;
    cameraId: string;
    actorUid: string;
    status: CameraStatus;
    latencyMs: number | null;
  }): Promise<void> {
    const path = `organizations/${params.orgId}/cameras/${params.cameraId}`;
    const logId = safeId('log');
    const batch = writeBatch(db);

    batch.update(doc(db, 'organizations', params.orgId, 'cameras', params.cameraId), {
      status: params.status,
      lastLatencyMs: params.latencyMs,
      lastCheckedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'camera.health_updated',
      resourceType: 'camera',
      resourceId: params.cameraId,
      summary: `Camera ${params.cameraId} status set to ${params.status}`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  },

  // ---------------------------------------------------------------------------
  // Vision Detections
  // ---------------------------------------------------------------------------
  async listVisionDetections(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<VisionDetectionRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'visionDetections', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        cameraId: String(d.cameraId),
        cameraName: String(d.cameraName),
        sourceType: d.sourceType as 'webcam' | 'upload' | 'camera_snapshot',
        peopleCount: Number(d.peopleCount),
        vehicleCount: Number(d.vehicleCount),
        anomalyCount: Number(d.anomalyCount),
        maxConfidence: Number(d.maxConfidence),
        inferenceMs: Number(d.inferenceMs),
        summary: String(d.summary),
        detections: Array.isArray(d.detections) ? (d.detections as DetectedObjectBox[]) : [],
        createdAt: tsToIso(d.createdAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async recordVisionDetection(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
    cameraId: string;
    cameraName: string;
    zone: string;
    sourceType: 'webcam' | 'upload' | 'camera_snapshot';
    peopleCount: number;
    vehicleCount: number;
    anomalyCount: number;
    maxConfidence: number;
    inferenceMs: number;
    summary: string;
    detections: DetectedObjectBox[];
  }): Promise<string> {
    const detectionId = safeId('det');
    const batch = writeBatch(db);

    batch.set(doc(db, 'organizations', params.orgId, 'visionDetections', detectionId), {
      id: detectionId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      cameraId: params.cameraId.slice(0, 128),
      cameraName: params.cameraName.slice(0, 120),
      sourceType: params.sourceType,
      peopleCount: Math.max(0, Math.trunc(params.peopleCount)),
      vehicleCount: Math.max(0, Math.trunc(params.vehicleCount)),
      anomalyCount: Math.max(0, Math.trunc(params.anomalyCount)),
      maxConfidence: Math.min(1, Math.max(0, params.maxConfidence)),
      inferenceMs: Math.max(0, Math.trunc(params.inferenceMs)),
      summary: params.summary.slice(0, 600),
      detections: params.detections.slice(0, 50),
      createdAt: serverTimestamp(),
    });

    if (params.anomalyCount > 0) {
      const eventId = safeId('evt');
      batch.set(doc(db, 'organizations', params.orgId, 'securityEvents', eventId), {
        id: eventId,
        orgId: params.orgId,
        orgOwnerUid: params.orgOwnerUid,
        createdByUid: params.actorUid,
        sourceModule: 'vision',
        eventType: 'vision.anomaly_detected',
        severity: params.anomalyCount > 1 ? 'high' : 'medium',
        cameraId: params.cameraId.slice(0, 128),
        zone: params.zone.slice(0, 80) || 'Perimeter',
        title: `Vision anomaly on ${params.cameraName}`.slice(0, 160),
        detail: params.summary.slice(0, 600),
        acknowledged: false,
        createdAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
      return detectionId;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `organizations/${params.orgId}/visionDetections/${detectionId}`
      );
    }
  },

  // ---------------------------------------------------------------------------
  // Video Intelligence Jobs
  // ---------------------------------------------------------------------------
  async listVideoJobs(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<VideoJobRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'videoJobs', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        fileName: String(d.fileName),
        fileSizeBytes: Number(d.fileSizeBytes),
        durationSec: Number(d.durationSec),
        resolution: String(d.resolution),
        framesSampled: Number(d.framesSampled),
        avgBrightness: Number(d.avgBrightness),
        avgSharpness: Number(d.avgSharpness),
        status: (d.status as 'completed' | 'failed') || 'completed',
        summary: String(d.summary),
        detectedPlates: Array.isArray(d.detectedPlates) ? (d.detectedPlates as string[]) : [],
        timeline: Array.isArray(d.timeline) ? (d.timeline as VideoTimelineMarker[]) : [],
        inferenceMs: Number(d.inferenceMs),
        createdAt: tsToIso(d.createdAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createVideoJob(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
    fileName: string;
    fileSizeBytes: number;
    durationSec: number;
    resolution: string;
    framesSampled: number;
    avgBrightness: number;
    avgSharpness: number;
    summary: string;
    detectedPlates: string[];
    timeline: VideoTimelineMarker[];
    inferenceMs: number;
  }): Promise<string> {
    const jobId = safeId('vid');
    const logId = safeId('log');
    const batch = writeBatch(db);

    batch.set(doc(db, 'organizations', params.orgId, 'videoJobs', jobId), {
      id: jobId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      fileName: params.fileName.slice(0, 200),
      fileSizeBytes: Math.max(0, Math.trunc(params.fileSizeBytes)),
      durationSec: Math.max(0, params.durationSec),
      resolution: params.resolution.slice(0, 32),
      framesSampled: Math.min(120, Math.max(1, Math.trunc(params.framesSampled))),
      avgBrightness: Math.min(255, Math.max(0, params.avgBrightness)),
      avgSharpness: Math.max(0, params.avgSharpness),
      status: 'completed',
      summary: params.summary.slice(0, 1000),
      detectedPlates: params.detectedPlates.slice(0, 30),
      timeline: params.timeline.slice(0, 50),
      inferenceMs: Math.max(0, Math.trunc(params.inferenceMs)),
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'video_job.completed',
      resourceType: 'video_job',
      resourceId: jobId,
      summary: `Analyzed video ${params.fileName} (${params.framesSampled} keyframes)`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      return jobId;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `organizations/${params.orgId}/videoJobs/${jobId}`);
    }
  },

  // ---------------------------------------------------------------------------
  // Multimodal Biometric Identities & Verifications
  // ---------------------------------------------------------------------------
  async listBiometricIdentities(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<BiometricIdentityRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'biometricIdentities', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        fullName: String(d.fullName),
        employeeCode: String(d.employeeCode),
        department: String(d.department),
        clearanceLevel: d.clearanceLevel as ClearanceLevel,
        status: (d.status as 'active' | 'suspended') || 'active',
        faceEnrolled: Boolean(d.faceEnrolled),
        voiceEnrolled: Boolean(d.voiceEnrolled),
        fingerprintEnrolled: Boolean(d.fingerprintEnrolled),
        faceDescriptorDigest: String(d.faceDescriptorDigest ?? ''),
        voiceDescriptorDigest: String(d.voiceDescriptorDigest ?? ''),
        fingerprintDescriptorDigest: String(d.fingerprintDescriptorDigest ?? ''),
        enrollmentNotes: String(d.enrollmentNotes ?? ''),
        createdAt: tsToIso(d.createdAt),
        updatedAt: tsToIso(d.updatedAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async enrollIdentity(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
    fullName: string;
    employeeCode: string;
    department: string;
    clearanceLevel: ClearanceLevel;
    faceDescriptorDigest: string;
    voiceDescriptorDigest: string;
    fingerprintDescriptorDigest: string;
    enrollmentNotes: string;
  }): Promise<string> {
    const identityId = safeId('bio');
    const logId = safeId('log');
    const batch = writeBatch(db);

    batch.set(doc(db, 'organizations', params.orgId, 'biometricIdentities', identityId), {
      id: identityId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      fullName: params.fullName.trim().slice(0, 120),
      employeeCode: params.employeeCode.trim().slice(0, 64),
      department: params.department.trim().slice(0, 80),
      clearanceLevel: params.clearanceLevel,
      status: 'active',
      faceEnrolled: Boolean(params.faceDescriptorDigest),
      voiceEnrolled: Boolean(params.voiceDescriptorDigest),
      fingerprintEnrolled: Boolean(params.fingerprintDescriptorDigest),
      faceDescriptorDigest: params.faceDescriptorDigest.slice(0, 128),
      voiceDescriptorDigest: params.voiceDescriptorDigest.slice(0, 128),
      fingerprintDescriptorDigest: params.fingerprintDescriptorDigest.slice(0, 128),
      enrollmentNotes: params.enrollmentNotes.trim().slice(0, 500),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'identity.enrolled',
      resourceType: 'biometric_identity',
      resourceId: identityId,
      summary: `Enrolled biometric profile for ${params.fullName} (${params.employeeCode})`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      return identityId;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `organizations/${params.orgId}/biometricIdentities/${identityId}`
      );
    }
  },

  async listVerificationLogs(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<VerificationLogRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'verificationLogs', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        identityId: String(d.identityId),
        identityName: String(d.identityName),
        checkpointName: String(d.checkpointName),
        modalitiesUsed: Array.isArray(d.modalitiesUsed) ? (d.modalitiesUsed as string[]) : [],
        faceScore: d.faceScore == null ? null : Number(d.faceScore),
        voiceScore: d.voiceScore == null ? null : Number(d.voiceScore),
        fingerprintScore: d.fingerprintScore == null ? null : Number(d.fingerprintScore),
        fusedScore: Number(d.fusedScore),
        livenessPassed: Boolean(d.livenessPassed),
        outcome: d.outcome as VerificationOutcome,
        rationale: String(d.rationale),
        createdAt: tsToIso(d.createdAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async recordVerificationLog(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
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
  }): Promise<string> {
    const logId = safeId('ver');
    const auditId = safeId('log');
    const batch = writeBatch(db);

    batch.set(doc(db, 'organizations', params.orgId, 'verificationLogs', logId), {
      id: logId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      identityId: params.identityId.slice(0, 128),
      identityName: params.identityName.slice(0, 120),
      checkpointName: params.checkpointName.slice(0, 120),
      modalitiesUsed: params.modalitiesUsed.slice(0, 3),
      faceScore: params.faceScore,
      voiceScore: params.voiceScore,
      fingerprintScore: params.fingerprintScore,
      fusedScore: Math.min(1, Math.max(0, params.fusedScore)),
      livenessPassed: params.livenessPassed,
      outcome: params.outcome,
      rationale: params.rationale.slice(0, 600),
      createdAt: serverTimestamp(),
    });

    if (params.outcome === 'failed') {
      const eventId = safeId('evt');
      batch.set(doc(db, 'organizations', params.orgId, 'securityEvents', eventId), {
        id: eventId,
        orgId: params.orgId,
        orgOwnerUid: params.orgOwnerUid,
        createdByUid: params.actorUid,
        sourceModule: 'identity',
        eventType: 'identity.verification_failed',
        severity: params.livenessPassed ? 'medium' : 'high',
        cameraId: 'checkpoint',
        zone: params.checkpointName.slice(0, 80),
        title: `Failed verification at ${params.checkpointName}`.slice(0, 160),
        detail: `Subject ${params.identityName} scored ${(params.fusedScore * 100).toFixed(1)}% (liveness=${params.livenessPassed}). ${params.rationale}`.slice(
          0,
          600
        ),
        acknowledged: false,
        createdAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', auditId), {
      id: auditId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: `identity.verification_${params.outcome}`,
      resourceType: 'verification_log',
      resourceId: logId,
      summary: `${params.outcome.toUpperCase()} verification for ${params.identityName} at ${params.checkpointName}`.slice(
        0,
        300
      ),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      return logId;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `organizations/${params.orgId}/verificationLogs/${logId}`
      );
    }
  },

  // ---------------------------------------------------------------------------
  // Security Events, Risk Assessments & Incidents
  // ---------------------------------------------------------------------------
  async listSecurityEvents(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<SecurityEventRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'securityEvents', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        sourceModule: d.sourceModule as SecurityEventRecord['sourceModule'],
        eventType: String(d.eventType),
        severity: d.severity as EventSeverity,
        cameraId: String(d.cameraId),
        zone: String(d.zone),
        title: String(d.title),
        detail: String(d.detail),
        acknowledged: Boolean(d.acknowledged),
        createdAt: tsToIso(d.createdAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createSecurityEvent(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
    sourceModule: SecurityEventRecord['sourceModule'];
    eventType: string;
    severity: EventSeverity;
    cameraId: string;
    zone: string;
    title: string;
    detail: string;
  }): Promise<string> {
    const eventId = safeId('evt');
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', params.orgId, 'securityEvents', eventId), {
      id: eventId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      sourceModule: params.sourceModule,
      eventType: params.eventType.slice(0, 80),
      severity: params.severity,
      cameraId: params.cameraId.slice(0, 128),
      zone: params.zone.slice(0, 80),
      title: params.title.slice(0, 160),
      detail: params.detail.slice(0, 600),
      acknowledged: false,
      createdAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      return eventId;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `organizations/${params.orgId}/securityEvents/${eventId}`
      );
    }
  },

  async acknowledgeSecurityEvent(orgId: string, eventId: string): Promise<void> {
    const batch = writeBatch(db);
    batch.update(doc(db, 'organizations', orgId, 'securityEvents', eventId), {
      acknowledged: true,
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `organizations/${orgId}/securityEvents/${eventId}`
      );
    }
  },

  async listRiskAssessments(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<RiskAssessmentRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'riskAssessments', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        targetLabel: String(d.targetLabel),
        zone: String(d.zone),
        riskScore: Number(d.riskScore),
        severity: d.severity as EventSeverity,
        factors: Array.isArray(d.factors) ? (d.factors as RiskFactorItem[]) : [],
        recommendation: String(d.recommendation),
        createdAt: tsToIso(d.createdAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createRiskAssessment(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
    targetLabel: string;
    zone: string;
    riskScore: number;
    severity: EventSeverity;
    factors: RiskFactorItem[];
    recommendation: string;
  }): Promise<string> {
    const assessmentId = safeId('rsk');
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', params.orgId, 'riskAssessments', assessmentId), {
      id: assessmentId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      targetLabel: params.targetLabel.slice(0, 160),
      zone: params.zone.slice(0, 80),
      riskScore: Math.min(100, Math.max(0, params.riskScore)),
      severity: params.severity,
      factors: params.factors.slice(0, 12),
      recommendation: params.recommendation.slice(0, 500),
      createdAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      return assessmentId;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `organizations/${params.orgId}/riskAssessments/${assessmentId}`
      );
    }
  },

  async listIncidents(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<IncidentRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'incidents', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        title: String(d.title),
        description: String(d.description),
        severity: d.severity as EventSeverity,
        status: d.status as IncidentStatus,
        zone: String(d.zone),
        linkedCameraId: String(d.linkedCameraId ?? ''),
        linkedEventId: String(d.linkedEventId ?? ''),
        riskScore: Number(d.riskScore),
        assignedToUid: String(d.assignedToUid ?? ''),
        resolutionNotes: String(d.resolutionNotes ?? ''),
        createdAt: tsToIso(d.createdAt),
        updatedAt: tsToIso(d.updatedAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createIncident(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
    title: string;
    description: string;
    severity: EventSeverity;
    zone: string;
    linkedCameraId?: string;
    linkedEventId?: string;
    riskScore: number;
  }): Promise<string> {
    const incidentId = safeId('inc');
    const logId = safeId('log');
    const batch = writeBatch(db);

    batch.set(doc(db, 'organizations', params.orgId, 'incidents', incidentId), {
      id: incidentId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      title: params.title.trim().slice(0, 160),
      description: params.description.trim().slice(0, 1200),
      severity: params.severity,
      status: 'open',
      zone: params.zone.trim().slice(0, 80),
      linkedCameraId: (params.linkedCameraId ?? '').slice(0, 128),
      linkedEventId: (params.linkedEventId ?? '').slice(0, 128),
      riskScore: Math.min(100, Math.max(0, params.riskScore)),
      assignedToUid: params.actorUid,
      resolutionNotes: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'incident.created',
      resourceType: 'incident',
      resourceId: incidentId,
      summary: `Opened ${params.severity.toUpperCase()} incident: ${params.title}`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      return incidentId;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `organizations/${params.orgId}/incidents/${incidentId}`
      );
    }
  },

  async updateIncident(params: {
    orgId: string;
    incidentId: string;
    actorUid: string;
    severity: EventSeverity;
    status: IncidentStatus;
    assignedToUid: string;
    resolutionNotes: string;
  }): Promise<void> {
    const logId = safeId('log');
    const batch = writeBatch(db);

    batch.update(doc(db, 'organizations', params.orgId, 'incidents', params.incidentId), {
      severity: params.severity,
      status: params.status,
      assignedToUid: params.assignedToUid.slice(0, 128),
      resolutionNotes: params.resolutionNotes.slice(0, 1200),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'incident.updated',
      resourceType: 'incident',
      resourceId: params.incidentId,
      summary: `Incident ${params.incidentId} transitioned to ${params.status} (${params.severity})`.slice(
        0,
        300
      ),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `organizations/${params.orgId}/incidents/${params.incidentId}`
      );
    }
  },

  // ---------------------------------------------------------------------------
  // AI Security Analyst Sessions
  // ---------------------------------------------------------------------------
  async listAnalystSessions(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<AnalystSessionRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'analystSessions', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        prompt: String(d.prompt),
        responseText: String(d.responseText),
        contextSnapshot: String(d.contextSnapshot),
        modelName: String(d.modelName),
        createdAt: tsToIso(d.createdAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async saveAnalystSession(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
    prompt: string;
    responseText: string;
    contextSnapshot: string;
    modelName: string;
  }): Promise<string> {
    const sessionId = safeId('ai');
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', params.orgId, 'analystSessions', sessionId), {
      id: sessionId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      prompt: params.prompt.slice(0, 1000),
      responseText: params.responseText.slice(0, 8000),
      contextSnapshot: params.contextSnapshot.slice(0, 1000),
      modelName: params.modelName.slice(0, 80),
      createdAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      return sessionId;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `organizations/${params.orgId}/analystSessions/${sessionId}`
      );
    }
  },

  // ---------------------------------------------------------------------------
  // Digital Evidence & Chain of Custody
  // ---------------------------------------------------------------------------
  async listEvidenceItems(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<EvidenceItemRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'evidenceItems', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        caseNumber: String(d.caseNumber),
        title: String(d.title),
        sourceType: d.sourceType as EvidenceItemRecord['sourceType'],
        fileName: String(d.fileName),
        fileSizeBytes: Number(d.fileSizeBytes),
        sha256Digest: String(d.sha256Digest),
        linkedIncidentId: String(d.linkedIncidentId ?? ''),
        custodyStatus: d.custodyStatus as EvidenceItemRecord['custodyStatus'],
        custodyNotes: String(d.custodyNotes ?? ''),
        createdAt: tsToIso(d.createdAt),
        updatedAt: tsToIso(d.updatedAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async preserveEvidenceItem(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
    caseNumber: string;
    title: string;
    sourceType: EvidenceItemRecord['sourceType'];
    fileName: string;
    fileSizeBytes: number;
    sha256Digest: string;
    linkedIncidentId: string;
    custodyNotes: string;
  }): Promise<string> {
    const evidenceId = safeId('evd');
    const logId = safeId('log');
    const batch = writeBatch(db);

    batch.set(doc(db, 'organizations', params.orgId, 'evidenceItems', evidenceId), {
      id: evidenceId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      caseNumber: params.caseNumber.trim().slice(0, 64),
      title: params.title.trim().slice(0, 160),
      sourceType: params.sourceType,
      fileName: params.fileName.trim().slice(0, 200),
      fileSizeBytes: Math.max(0, Math.trunc(params.fileSizeBytes)),
      sha256Digest: params.sha256Digest.toLowerCase(),
      linkedIncidentId: params.linkedIncidentId.slice(0, 128),
      custodyStatus: 'sealed',
      custodyNotes: params.custodyNotes.trim().slice(0, 600),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'evidence.sealed',
      resourceType: 'evidence_item',
      resourceId: evidenceId,
      summary: `Sealed digital evidence ${params.caseNumber}: ${params.title} (SHA-256 ${params.sha256Digest.slice(0, 12)}...)`.slice(
        0,
        300
      ),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      return evidenceId;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `organizations/${params.orgId}/evidenceItems/${evidenceId}`
      );
    }
  },

  async updateEvidenceCustody(params: {
    orgId: string;
    evidenceId: string;
    actorUid: string;
    custodyStatus: EvidenceItemRecord['custodyStatus'];
    custodyNotes: string;
    linkedIncidentId: string;
  }): Promise<void> {
    const logId = safeId('log');
    const batch = writeBatch(db);

    batch.update(doc(db, 'organizations', params.orgId, 'evidenceItems', params.evidenceId), {
      custodyStatus: params.custodyStatus,
      custodyNotes: params.custodyNotes.slice(0, 600),
      linkedIncidentId: params.linkedIncidentId.slice(0, 128),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'evidence.custody_updated',
      resourceType: 'evidence_item',
      resourceId: params.evidenceId,
      summary: `Evidence ${params.evidenceId} custody state set to ${params.custodyStatus}`.slice(
        0,
        300
      ),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `organizations/${params.orgId}/evidenceItems/${params.evidenceId}`
      );
    }
  },

  // ---------------------------------------------------------------------------
  // Research Lab Benchmarks & Reports
  // ---------------------------------------------------------------------------
  async listBenchmarkRuns(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<BenchmarkRunRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'benchmarkRuns', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        runName: String(d.runName),
        datasetSource: d.datasetSource as 'live_verifications' | 'imported_scores',
        sampleCount: Number(d.sampleCount),
        threshold: Number(d.threshold),
        far: Number(d.far),
        frr: Number(d.frr),
        tar: Number(d.tar),
        eer: Number(d.eer),
        auc: Number(d.auc),
        avgLatencyMs: Number(d.avgLatencyMs),
        createdAt: tsToIso(d.createdAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async saveBenchmarkRun(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
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
  }): Promise<string> {
    const runId = safeId('bmk');
    const batch = writeBatch(db);
    batch.set(doc(db, 'organizations', params.orgId, 'benchmarkRuns', runId), {
      id: runId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      runName: params.runName.trim().slice(0, 120),
      datasetSource: params.datasetSource,
      sampleCount: Math.max(1, Math.trunc(params.sampleCount)),
      threshold: params.threshold,
      far: params.far,
      frr: params.frr,
      tar: params.tar,
      eer: params.eer,
      auc: params.auc,
      avgLatencyMs: Math.max(0, params.avgLatencyMs),
      createdAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      return runId;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `organizations/${params.orgId}/benchmarkRuns/${runId}`
      );
    }
  },

  async listSecurityReports(
    orgId: string,
    actorUid: string,
    actorEmail: string
  ): Promise<SecurityReportRecord[]> {
    const rows = await listOrgScopedDocs(orgId, 'securityReports', actorUid, actorEmail);
    return rows
      .map((d) => ({
        id: String(d.id),
        orgId: String(d.orgId),
        orgOwnerUid: String(d.orgOwnerUid),
        createdByUid: String(d.createdByUid),
        title: String(d.title),
        reportType: d.reportType as SecurityReportRecord['reportType'],
        summary: String(d.summary),
        metricsSnapshot: d.metricsSnapshot as SecurityReportRecord['metricsSnapshot'],
        createdAt: tsToIso(d.createdAt),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createSecurityReport(params: {
    orgId: string;
    orgOwnerUid: string;
    actorUid: string;
    title: string;
    reportType: SecurityReportRecord['reportType'];
    summary: string;
    metricsSnapshot: SecurityReportRecord['metricsSnapshot'];
  }): Promise<string> {
    const reportId = safeId('rpt');
    const logId = safeId('log');
    const batch = writeBatch(db);

    batch.set(doc(db, 'organizations', params.orgId, 'securityReports', reportId), {
      id: reportId,
      orgId: params.orgId,
      orgOwnerUid: params.orgOwnerUid,
      createdByUid: params.actorUid,
      title: params.title.trim().slice(0, 160),
      reportType: params.reportType,
      summary: params.summary.slice(0, 2000),
      metricsSnapshot: params.metricsSnapshot,
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, 'organizations', params.orgId, 'auditLogs', logId), {
      id: logId,
      orgId: params.orgId,
      actorUid: params.actorUid,
      action: 'report.generated',
      resourceType: 'security_report',
      resourceId: reportId,
      summary: `Generated ${params.reportType} report: ${params.title}`.slice(0, 300),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      return reportId;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `organizations/${params.orgId}/securityReports/${reportId}`
      );
    }
  },
};
