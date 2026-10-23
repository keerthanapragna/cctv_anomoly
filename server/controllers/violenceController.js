import mongoose from 'mongoose'
import { Incident } from '../models/Incident.js'
import { Sensor } from '../models/Sensor.js'
import { User } from '../models/User.js'
import { env } from '../config/env.js'
import {
  ROLES,
  SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_SOURCES,
  SLA_THRESHOLDS_MINUTES,
} from '../config/constants.js'
import { successResponse, errorResponse } from '../utils/apiResponse.js'
import { broadcastSse } from './aiController.js'

/**
 * Shared helper: attempts to persist or deduplicate an incident in MongoDB.
 * Reports honestly if MongoDB is offline or disconnected without fabricating success.
 */
async function recordViolenceIncident({
  confidence,
  uncertainty,
  threshold,
  severity,
  requiresHumanReview,
  cameraId = 'CAM-WEBCAM',
  source = 'webcam',
  details = '',
  notes = '',
}) {
  // Verify MongoDB connection state
  const isDbConnected = mongoose.connection.readyState === 1
  if (!isDbConnected) {
    return {
      persisted: false,
      deduplicated: false,
      incidentId: null,
      message: 'MongoDB is offline or unreachable. Detection was not saved to database.',
    }
  }

  // Deduplication check: active incident for this camera within cooldown window
  const cooldownSeconds = env.VIOLENCE_COOLDOWN_SECONDS || 45
  const cooldownWindow = new Date(Date.now() - cooldownSeconds * 1000)

  const existingActive = await Incident.findOne({
    'evidenceMetadata.sensorId': cameraId,
    hazardCategory: { $in: ['Fight detection', 'Violence detection'] },
    status: {
      $in: [
        INCIDENT_STATUSES.NEW,
        INCIDENT_STATUSES.ASSIGNED,
        INCIDENT_STATUSES.INVESTIGATING,
        INCIDENT_STATUSES.UNDER_REVIEW,
      ],
    },
    createdAt: { $gte: cooldownWindow },
  })

  if (existingActive) {
    // Append observation note to avoid duplicate records
    const eventTimeStr = new Date().toLocaleTimeString()
    existingActive.notes = `${existingActive.notes || ''}\n[${eventTimeStr}] Consecutive cue: score=${confidence.toFixed(2)}, unc=${uncertainty.toFixed(2)}`.trim()
    await existingActive.save()

    return {
      persisted: true,
      deduplicated: true,
      incidentId: existingActive.incidentId,
      incident: existingActive,
      message: `Consecutive detection grouped with active incident ${existingActive.incidentId} (cooldown: ${cooldownSeconds}s).`,
    }
  }

  // Resolve reporting user (Default to Security Officer or Admin)
  let reporter = await User.findOne({ role: ROLES.SECURITY_OFFICER })
  if (!reporter) {
    reporter = await User.findOne({ role: ROLES.ADMIN })
  }
  if (!reporter) {
    reporter = await User.findOne()
  }

  if (!reporter) {
    return {
      persisted: false,
      deduplicated: false,
      incidentId: null,
      message: 'No system user available to record incident.',
    }
  }

  // Map severity string to system standard SEVERITIES enum
  let mappedSeverity = SEVERITIES.HIGH
  if (severity && severity.toLowerCase().includes('severe')) {
    mappedSeverity = SEVERITIES.CRITICAL
  } else if (severity && severity.toLowerCase().includes('moderate')) {
    mappedSeverity = SEVERITIES.HIGH
  } else if (severity && severity.toLowerCase().includes('slight')) {
    mappedSeverity = SEVERITIES.LOW
  }

  // Generate unique sequential Incident ID
  const year = new Date().getFullYear()
  const count = await Incident.countDocuments()
  const incidentId = `INC-${year}-${String(140 + count + 1).padStart(4, '0')}`

  const slaMins = SLA_THRESHOLDS_MINUTES[mappedSeverity]?.acknowledge || 30
  const deadlineStr = `${slaMins} mins (Urgent)`
  const now = new Date()

  // Format location info
  const locationObj = {
    building: 'Main Campus',
    floor: 'Ground Floor',
    zone: cameraId,
    rawText: `${cameraId} Monitored Zone`,
  }

  const title = `Suspected violence detected on ${cameraId}`
  const description =
    details ||
    `Automated AI Perception Alert: ${severity} (violence probability ${(confidence * 100).toFixed(1)}%, uncertainty ${uncertainty.toFixed(2)}) detected via ${source}. Human officer verification required.`

  const newIncident = await Incident.create({
    incidentId,
    title,
    description,
    hazardCategory: 'Fight detection',
    severity: mappedSeverity,
    location: locationObj,
    department: 'Central Physical Security',
    status: INCIDENT_STATUSES.NEW,
    source: INCIDENT_SOURCES.AI_CAMERA,
    reportedBy: reporter._id,
    assignedTo: reporter._id,
    assigneeLabel: 'Campus Security',
    assignedOfficer: reporter.name || 'Duty Security Officer',
    detectedAt: now,
    assignedAt: now,
    assignmentHistory: [
      {
        assignedTo: reporter._id,
        assigneeLabel: 'Campus Security',
        assignedOfficer: reporter.name || 'Duty Security Officer',
        department: 'Central Physical Security',
        assignedAt: now,
        assignedBy: reporter._id,
        note: `Auto-dispatched to Campus Security by Violence Detection Pipeline (Score: ${(confidence * 100).toFixed(1)}%, Uncertainty: ${uncertainty.toFixed(2)})`,
      },
    ],
    deadline: deadlineStr,
    evidenceMetadata: {
      sensorId: cameraId,
      sensorStatus: 'Active Hazard Alert',
      snapshotUrl: '',
      tamperFlags: [],
      sourceType: source,
      violenceScore: confidence,
      uncertaintyScore: uncertainty,
      decisionThreshold: threshold,
      requiresHumanReview: Boolean(requiresHumanReview),
      humanReviewStatus: 'Pending Verification',
    },
    notes:
      notes ||
      `AI Violence Detection Alert\nViolence Probability: ${(confidence * 100).toFixed(1)}%\nModel Uncertainty: ${uncertainty.toFixed(2)}\nProvisional Severity: ${severity}\nHuman Review Required: ${requiresHumanReview ? 'YES' : 'NO'}\nSource: ${source}\nTimestamp: ${now.toISOString()}`,
  })

  // Broadcast to SSE clients for instant live UI update
  broadcastSse('incident_created', {
    incidentId: newIncident.incidentId,
    title: newIncident.title,
    hazardCategory: newIncident.hazardCategory,
    severity: newIncident.severity,
    location: newIncident.location,
    status: newIncident.status,
    detectedAt: newIncident.detectedAt,
  })

  return {
    persisted: true,
    deduplicated: false,
    incidentId: newIncident.incidentId,
    incident: newIncident,
    message: `Genuine safety incident ${newIncident.incidentId} recorded in MongoDB.`,
  }
}

/**
 * 1. GET /api/v1/violence/status
 * Check operational health of Python violence inference service & MongoDB connection
 */
export async function getViolenceStatus(req, res) {
  const violenceUrl = env.VIOLENCE_SERVICE_URL || 'http://127.0.0.1:8001'
  let pythonHealth = {
    status: 'offline',
    service: 'violence-detection-service (not connected)',
    error: null,
  }

  try {
    const pyRes = await fetch(`${violenceUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (pyRes.ok) {
      pythonHealth = await pyRes.json()
    } else {
      pythonHealth.status = 'error'
      pythonHealth.error = `HTTP ${pyRes.status}`
    }
  } catch (err) {
    pythonHealth.error = err.message
  }

  const dbStatus =
    mongoose.connection.readyState === 1
      ? 'connected'
      : mongoose.connection.readyState === 2
        ? 'connecting'
        : 'disconnected'

  return successResponse(res, {
    message: 'Violence Detection Subsystem Status',
    data: {
      subsystem: 'Violence & Altercation Perception Pipeline',
      pythonService: pythonHealth,
      database: dbStatus,
      defaultThreshold: env.VIOLENCE_THRESHOLD || 0.65,
      uncertaintyThreshold: env.VIOLENCE_UNCERTAINTY_THRESHOLD || 0.40,
      cooldownSeconds: env.VIOLENCE_COOLDOWN_SECONDS || 45,
      supportedSources: ['webcam', 'cctv', 'uploaded_video'],
    },
  })
}

/**
 * 2. POST /api/v1/violence/analyze-video
 * Upload a recorded video file, validate, forward to Python inference service,
 * and persist qualifying detections to MongoDB.
 */
export async function analyzeVideoUpload(req, res, next) {
  try {
    if (!req.file) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'No video file uploaded. Please select an MP4, AVI, MOV, MKV, or WebM file.',
      })
    }

    const { threshold: reqThreshold, cameraId = 'CAM-FILE-01' } = req.body
    const threshold = reqThreshold ? parseFloat(reqThreshold) : (env.VIOLENCE_THRESHOLD || 0.65)
    const violenceUrl = env.VIOLENCE_SERVICE_URL || 'http://127.0.0.1:8001'

    // Forward file buffer to Python service via native FormData
    const formData = new FormData()
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'video/mp4' })
    formData.append('file', blob, req.file.originalname || 'video.mp4')

    let pyResponse
    try {
      pyResponse = await fetch(`${violenceUrl}/analyze?threshold=${threshold}`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60000), // 60s timeout for video inference
      })
    } catch (netErr) {
      return errorResponse(res, {
        statusCode: 503,
        message: `Python Violence Inference Service unavailable at ${violenceUrl}. Please ensure 'python service.py' is running. (${netErr.message})`,
      })
    }

    if (!pyResponse.ok) {
      const errData = await pyResponse.json().catch(() => ({}))
      return errorResponse(res, {
        statusCode: pyResponse.status || 500,
        message: errData.detail || 'Inference service returned an error processing the video.',
      })
    }

    const inferenceResult = await pyResponse.json()

    // Broadcast live event cue to dashboard SSE
    broadcastSse('violence_detection', {
      type: 'violence_detected',
      source: 'uploaded_video',
      filename: req.file.originalname,
      cameraId,
      confidence: inferenceResult.violence_prob,
      uncertainty: inferenceResult.uncertainty_score,
      severity: inferenceResult.severity_assessment,
      priority: inferenceResult.response_priority,
      requiresHumanReview: inferenceResult.requires_human_review,
      qualifiesAsIncident: inferenceResult.qualifies_as_incident,
      timestamp: new Date().toISOString(),
    })

    // If qualifying incident, persist or deduplicate in MongoDB
    let persistenceResult = {
      persisted: false,
      deduplicated: false,
      incidentId: null,
      message: 'Video evaluated; does not meet qualifying incident criteria.',
    }

    if (inferenceResult.qualifies_as_incident) {
      persistenceResult = await recordViolenceIncident({
        confidence: inferenceResult.violence_prob,
        uncertainty: inferenceResult.uncertainty_score,
        threshold: inferenceResult.threshold,
        severity: inferenceResult.severity_assessment,
        requiresHumanReview: inferenceResult.requires_human_review,
        cameraId,
        source: 'uploaded_video',
        details: `Uploaded Video Analysis: ${inferenceResult.severity_assessment} (file: ${req.file.originalname}, score: ${(inferenceResult.violence_prob * 100).toFixed(1)}%, unc: ${inferenceResult.uncertainty_score.toFixed(2)})`,
        notes: `File: ${req.file.originalname}\nSize: ${req.file.size} bytes\n${inferenceResult.policy_explanation}`,
      })
    }

    console.log(
      `[DEV_LOG][VIDEO_INFERENCE] file=${req.file.originalname} size=${req.file.size} ` +
      `prob=${(inferenceResult.violence_prob * 100).toFixed(1)}% unc=${inferenceResult.uncertainty_score} ` +
      `threshold=${threshold} qualifies=${inferenceResult.qualifies_as_incident} severity="${inferenceResult.severity_assessment}" ` +
      `persisted=${persistenceResult.persisted} dedup=${persistenceResult.deduplicated} incidentId=${persistenceResult.incidentId || 'none'}`
    )

    return successResponse(res, {
      message: 'Video analysis completed successfully',
      data: {
        inference: inferenceResult,
        persistence: persistenceResult,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * 3. POST /api/v1/violence/analyze-frames
 * Accept a temporal sequence of 16 base64 JPEG frames from browser webcam or client sampler.
 * Runs CPU inference with dual heads (violence score & uncertainty), applies triage policy,
 * and persists qualifying incidents to MongoDB with cooldown deduplication.
 */
export async function analyzeFrameSequence(req, res, next) {
  try {
    const { frames, threshold: reqThreshold, cameraId = 'CAM-WEBCAM', source = 'webcam' } = req.body
    const threshold = reqThreshold ? parseFloat(reqThreshold) : (env.VIOLENCE_THRESHOLD || 0.65)
    const violenceUrl = env.VIOLENCE_SERVICE_URL || 'http://127.0.0.1:8001'

    let pyResponse
    try {
      pyResponse = await fetch(`${violenceUrl}/analyze-frames`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames,
          threshold,
          camera_id: cameraId,
          source,
        }),
        signal: AbortSignal.timeout(15000), // 15s timeout
      })
    } catch (netErr) {
      return errorResponse(res, {
        statusCode: 503,
        message: `Python Violence Inference Service unavailable at ${violenceUrl}. Please ensure 'python service.py' is running. (${netErr.message})`,
      })
    }

    if (!pyResponse.ok) {
      const errData = await pyResponse.json().catch(() => ({}))
      return errorResponse(res, {
        statusCode: pyResponse.status || 500,
        message: errData.detail || 'Inference service returned an error analyzing frame sequence.',
      })
    }

    const inferenceResult = await pyResponse.json()

    // Push real-time cue to dashboard SSE clients
    broadcastSse('violence_detection', {
      type: 'violence_detected',
      source,
      cameraId,
      confidence: inferenceResult.violence_prob,
      uncertainty: inferenceResult.uncertainty_score,
      severity: inferenceResult.severity_assessment,
      priority: inferenceResult.response_priority,
      requiresHumanReview: inferenceResult.requires_human_review,
      qualifiesAsIncident: inferenceResult.qualifies_as_incident,
      timestamp: new Date().toISOString(),
    })

    // If qualifying incident, persist or deduplicate in MongoDB
    let persistenceResult = {
      persisted: false,
      deduplicated: false,
      incidentId: null,
      message: 'Frame sequence evaluated; below qualifying threshold.',
    }

    if (inferenceResult.qualifies_as_incident) {
      persistenceResult = await recordViolenceIncident({
        confidence: inferenceResult.violence_prob,
        uncertainty: inferenceResult.uncertainty_score,
        threshold: inferenceResult.threshold,
        severity: inferenceResult.severity_assessment,
        requiresHumanReview: inferenceResult.requires_human_review,
        cameraId,
        source,
        details: `Live ${source.toUpperCase()} Alert: ${inferenceResult.severity_assessment} on ${cameraId} (score: ${(inferenceResult.violence_prob * 100).toFixed(1)}%, unc: ${inferenceResult.uncertainty_score.toFixed(2)})`,
        notes: `Temporal Frame Inference\n${inferenceResult.policy_explanation}\nProcessing Latency: ${inferenceResult.processing_time_ms} ms`,
      })
    }

    console.log(
      `[DEV_LOG][FRAME_INFERENCE] camera=${cameraId} source=${source} frames=${frames?.length} ` +
      `prob=${(inferenceResult.violence_prob * 100).toFixed(1)}% unc=${inferenceResult.uncertainty_score} ` +
      `threshold=${threshold} qualifies=${inferenceResult.qualifies_as_incident} severity="${inferenceResult.severity_assessment}" ` +
      `persisted=${persistenceResult.persisted} dedup=${persistenceResult.deduplicated} incidentId=${persistenceResult.incidentId || 'none'}`
    )

    return successResponse(res, {
      message: 'Frame sequence analyzed successfully',
      data: {
        inference: inferenceResult,
        persistence: persistenceResult,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * 4. POST /api/v1/violence/cctv/start
 * Start background CCTV / RTSP stream monitoring worker.
 * Restricted to ADMIN and SECURITY_OFFICER roles.
 */
export async function startCctvMonitoring(req, res, next) {
  try {
    const { streamUrl: reqUrl, cameraId = 'CAM-CCTV-01', sampleInterval = 4.0, threshold = 0.65 } = req.body
    const violenceUrl = env.VIOLENCE_SERVICE_URL || 'http://127.0.0.1:8001'

    // Securely resolve stream URL on server (env or authorized admin input)
    const streamUrl = reqUrl || env.CCTV_STREAM_URL
    if (!streamUrl) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'No CCTV stream URL provided in request or configured in server environment (CCTV_STREAM_URL).',
      })
    }

    const backendIngestUrl = `http://127.0.0.1:${env.PORT || 5000}`

    const pyResponse = await fetch(`${violenceUrl}/cctv/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stream_url: streamUrl,
        camera_id: cameraId,
        sample_interval: sampleInterval,
        threshold,
        backend_ingest_url: backendIngestUrl,
        ingest_api_key: env.INGEST_API_KEY,
      }),
      signal: AbortSignal.timeout(5000),
    }).catch((err) => {
      throw new Error(`Inference service unavailable (${err.message})`)
    })

    const data = await pyResponse.json()
    return successResponse(res, {
      message: data.message || 'CCTV monitoring started',
      data,
    })
  } catch (err) {
    next(err)
  }
}

/**
 * 5. POST /api/v1/violence/cctv/stop
 * Stop background CCTV monitoring worker.
 */
export async function stopCctvMonitoring(req, res, next) {
  try {
    const violenceUrl = env.VIOLENCE_SERVICE_URL || 'http://127.0.0.1:8001'
    const pyResponse = await fetch(`${violenceUrl}/cctv/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    }).catch((err) => {
      throw new Error(`Inference service unavailable (${err.message})`)
    })

    const data = await pyResponse.json()
    return successResponse(res, {
      message: data.message || 'CCTV monitoring stopped',
      data,
    })
  } catch (err) {
    next(err)
  }
}

/**
 * 6. GET /api/v1/violence/cctv/status
 * Query operational status of background CCTV worker.
 */
export async function getCctvStatus(req, res, next) {
  try {
    const violenceUrl = env.VIOLENCE_SERVICE_URL || 'http://127.0.0.1:8001'
    const pyResponse = await fetch(`${violenceUrl}/cctv/status`, {
      signal: AbortSignal.timeout(3000),
    }).catch(() => null)

    if (!pyResponse || !pyResponse.ok) {
      return successResponse(res, {
        message: 'CCTV monitoring status (Python service offline)',
        data: {
          is_running: false,
          status: 'service_offline',
        },
      })
    }

    const data = await pyResponse.json()
    return successResponse(res, {
      message: 'CCTV monitoring status',
      data,
    })
  } catch (err) {
    next(err)
  }
}

/**
 * 7. POST /api/v1/violence/ingest
 * Ingestion callback endpoint for Python background CCTV worker.
 * Protected by x-ingest-api-key.
 */
export async function ingestCctvDetection(req, res, next) {
  try {
    const clientKey =
      req.headers['x-ingest-api-key'] ||
      req.headers['x-api-key'] ||
      req.query.apiKey

    if (!clientKey || clientKey !== env.INGEST_API_KEY) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Unauthorized: Invalid or missing INGEST_API_KEY.',
      })
    }

    const {
      confidence = 0.85,
      cameraId = 'CAM-CCTV-01',
      details,
      metadata = {},
    } = req.body

    const persistenceResult = await recordViolenceIncident({
      confidence,
      uncertainty: metadata.uncertainty || 0.20,
      threshold: metadata.threshold || 0.65,
      severity: metadata.severity || SEVERITIES.HIGH,
      requiresHumanReview: metadata.requires_human_review || false,
      cameraId,
      source: 'cctv',
      details,
      notes: `Automated CCTV Alert Forwarded by Background Worker`,
    })

    return successResponse(res, {
      statusCode: persistenceResult.persisted && !persistenceResult.deduplicated ? 201 : 200,
      message: persistenceResult.message,
      data: persistenceResult,
    })
  } catch (err) {
    next(err)
  }
}
