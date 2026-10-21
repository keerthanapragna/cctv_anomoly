import { Incident } from '../models/Incident.js'
import { Sensor } from '../models/Sensor.js'
import { User } from '../models/User.js'
import { env } from '../config/env.js'
import {
  HAZARD_CATEGORIES,
  SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_SOURCES,
  ROLES,
} from '../config/constants.js'
import { successResponse, errorResponse } from '../utils/apiResponse.js'

// Set of active SSE connection response objects
const sseClients = new Set()

// Last detection broadcast cache
let lastDetectionEvent = null
let detectionStats = {
  totalReceived: 0,
  incidentsCreated: 0,
  deduplicatedCount: 0,
  lastDetectionTime: null,
}

/**
 * Broadcast an event payload to all connected SSE clients
 */
export function broadcastSse(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    try {
      client.write(payload)
    } catch {
      sseClients.delete(client)
    }
  }
}

/**
 * Map raw model output / heuristic names to system standard hazard categories
 */
function mapHazardCategory(rawCategory) {
  if (!rawCategory) return 'Human safety'
  const norm = rawCategory.toUpperCase()
  if (norm.includes('FALL')) return 'Fall detection'
  if (norm.includes('DOG')) return 'Dog attack detection'
  if (norm.includes('ALTERCATION') || norm.includes('FIGHT')) return 'Fight detection'

  // Match existing categories
  const matched = HAZARD_CATEGORIES.find(
    (c) => c.toLowerCase() === rawCategory.toLowerCase(),
  )
  return matched || 'Human safety'
}

/**
 * Assign appropriate severity based on the hazard category
 */
function determineSeverity(hazardCategory, explicitSeverity) {
  if (explicitSeverity && Object.values(SEVERITIES).includes(explicitSeverity)) {
    return explicitSeverity
  }
  switch (hazardCategory) {
    case 'Fall detection':
      return SEVERITIES.CRITICAL
    case 'Dog attack detection':
      return SEVERITIES.HIGH
    case 'Fight detection':
      return SEVERITIES.HIGH
    default:
      return SEVERITIES.MEDIUM
  }
}

/**
 * Ingestion handler: accepts validated hazard detections from Python inference pipeline
 */
export async function ingestDetection(req, res, next) {
  try {
    // 1. Verify ingestion API key
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
      category: rawCategory,
      confidence = 0.85,
      cameraId,
      timestamp,
      details,
      location: reqLocation,
      metadata,
      snapshotUrl = '',
    } = req.body

    const hazardCategory = mapHazardCategory(rawCategory)
    const severity = determineSeverity(hazardCategory)
    const eventTime = timestamp ? new Date(timestamp) : new Date()

    detectionStats.totalReceived += 1
    detectionStats.lastDetectionTime = eventTime

    // 2. Incident Deduplication
    // Check if an active incident for this camera and category was created in the last 45 seconds
    const dedupeWindow = new Date(Date.now() - 45 * 1000)
    const existingActive = await Incident.findOne({
      'evidenceMetadata.sensorId': cameraId,
      hazardCategory,
      status: {
        $in: [
          INCIDENT_STATUSES.NEW,
          INCIDENT_STATUSES.ASSIGNED,
          INCIDENT_STATUSES.INVESTIGATING,
          INCIDENT_STATUSES.UNDER_REVIEW,
        ],
      },
      createdAt: { $gte: dedupeWindow },
    })

    const liveEventData = {
      type: 'hazard_detected',
      category: hazardCategory,
      severity,
      confidence: parseFloat(confidence.toFixed(2)),
      cameraId,
      timestamp: eventTime.toISOString(),
      details: details || `Automated ${hazardCategory} trigger on ${cameraId}`,
      metadata: metadata || {},
      snapshotUrl,
      deduplicated: Boolean(existingActive),
      incidentId: existingActive ? existingActive.incidentId : null,
    }

    lastDetectionEvent = liveEventData
    // Always push live detection to SSE stream for real-time visual dashboard cues
    broadcastSse('detection', liveEventData)

    if (existingActive) {
      detectionStats.deduplicatedCount += 1
      // Append observation note to avoid duplicate records
      existingActive.notes = `${existingActive.notes || ''}\n[${eventTime.toLocaleTimeString()}] Consecutive cue: conf=${confidence.toFixed(2)}`.trim()
      await existingActive.save()

      return successResponse(res, {
        statusCode: 200,
        message: `Detection received. Deduplicated against active incident ${existingActive.incidentId}.`,
        data: {
          deduplicated: true,
          incidentId: existingActive.incidentId,
          hazardCategory,
          confidence,
        },
      })
    }

    // 3. Resolve location and department from registered sensor or fallback defaults
    let sensorRecord = null
    try {
      sensorRecord = await Sensor.findOne({ sensorId: cameraId })
    } catch {
      // Non-critical if sensors table is offline
    }

    let locationObj = {
      building: 'Main Campus',
      floor: 'Ground Floor',
      zone: 'CCTV Perimeter',
      rawText: `${cameraId} Monitor Zone`,
    }

    if (sensorRecord?.location) {
      locationObj = {
        building: sensorRecord.location.split('·')[0]?.trim() || 'Main Campus',
        floor: '',
        zone: cameraId,
        rawText: sensorRecord.location,
      }
    } else if (reqLocation) {
      if (typeof reqLocation === 'string') {
        locationObj = {
          building: reqLocation.split('·')[0]?.trim() || 'Main Campus',
          floor: '',
          zone: cameraId,
          rawText: reqLocation,
        }
      } else {
        locationObj = {
          building: reqLocation.building || 'Main Campus',
          floor: reqLocation.floor || '',
          zone: reqLocation.zone || cameraId,
          rawText: reqLocation.rawText || `${cameraId} Zone`,
        }
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
      return errorResponse(res, {
        statusCode: 500,
        message: 'No authorized system user available to record AI incident.',
      })
    }

    // Generate unique sequential Incident ID
    const year = new Date().getFullYear()
    const count = await Incident.countDocuments()
    const incidentId = `INC-${year}-${String(140 + count + 1).padStart(4, '0')}`

    const title = `${hazardCategory} detected on ${cameraId}`
    const description =
      details ||
      `Automated AI perception alarm: ${hazardCategory} (confidence ${(confidence * 100).toFixed(0)}%) detected via camera stream ${cameraId}. Human verification required.`

    const newIncident = await Incident.create({
      incidentId,
      title,
      description,
      hazardCategory,
      severity,
      location: locationObj,
      department: 'Central Physical Security',
      status: INCIDENT_STATUSES.NEW,
      source: INCIDENT_SOURCES.AI_CAMERA,
      reportedBy: reporter._id,
      assigneeLabel: 'Campus Security',
      detectedAt: eventTime,
      assignedAt: eventTime,
      assignmentHistory: [
        {
          assigneeLabel: 'Campus Security',
          department: 'Central Physical Security',
          assignedAt: eventTime,
          assignedBy: reporter._id,
          note: `Auto-dispatched to Campus Security by AI Perception pipeline (Confidence: ${(confidence * 100).toFixed(1)}%)`,
        },
      ],
      deadline: severity === SEVERITIES.CRITICAL ? '15 mins (Urgent)' : '30 mins (Urgent)',
      evidenceMetadata: {
        sensorId: cameraId,
        sensorStatus: 'Active Hazard Alert',
        snapshotUrl: snapshotUrl || '',
        tamperFlags: [],
      },
      notes: `AI Perception Alert · Model Confidence: ${(confidence * 100).toFixed(1)}%\nTimestamp: ${eventTime.toISOString()}`,
    })

    detectionStats.incidentsCreated += 1

    // Update sensor health & status in database if sensor exists
    if (sensorRecord) {
      sensorRecord.status = `Alarm: ${hazardCategory}`
      sensorRecord.lastPing = eventTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      await sensorRecord.save().catch(() => {})
    }

    // Notify dashboard of newly registered incident
    broadcastSse('incident_created', {
      incidentId: newIncident.incidentId,
      title: newIncident.title,
      hazardCategory: newIncident.hazardCategory,
      severity: newIncident.severity,
      location: newIncident.location,
      status: newIncident.status,
      detectedAt: newIncident.detectedAt,
    })

    return successResponse(res, {
      statusCode: 201,
      message: `Genuine detection stored: Incident ${newIncident.incidentId} created.`,
      data: {
        deduplicated: false,
        incident: newIncident,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Real-time SSE Stream Endpoint for Browser Dashboard
 */
export function streamDetections(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Credentials': 'true',
  })

  // Send initial handshake
  res.write(
    `event: connected\ndata: ${JSON.stringify({
      status: 'connected',
      timestamp: new Date().toISOString(),
      activeClients: sseClients.size + 1,
      lastEvent: lastDetectionEvent,
    })}\n\n`,
  )

  sseClients.add(res)

  // Heartbeat ping every 15 seconds to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n')
    } catch {
      clearInterval(heartbeat)
      sseClients.delete(res)
    }
  }, 15000)

  req.on('close', () => {
    clearInterval(heartbeat)
    sseClients.delete(res)
  })
}

/**
 * Returns current status of the AI Inference subsystem and detection counts
 */
export async function getAiStatus(req, res) {
  let inferenceHealth = { status: 'offline', service: 'CCTV AI Hazard Inference Service (not connected)' }
  const inferenceUrl = env.INFERENCE_SERVICE_URL || 'http://127.0.0.1:8000'
  try {
    const pyRes = await fetch(`${inferenceUrl}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    if (pyRes.ok) {
      inferenceHealth = await pyRes.json()
    }
  } catch {
    // Inference service offline
  }

  return successResponse(res, {
    message: 'AI Hazard Detection Subsystem status',
    data: {
      status: 'operational',
      connectedClients: sseClients.size,
      stats: detectionStats,
      lastEvent: lastDetectionEvent,
      inferenceService: inferenceHealth,
      supportedCategories: [
        'Fall detection',
        'Dog attack detection',
        'Fight detection',
      ],
    },
  })
}

/**
 * Perform AI inference on a single uploaded image
 */
export async function inferImage(req, res, next) {
  try {
    const { image, cameraId = 'CAM-01', sourceId } = req.body
    const targetCamId = cameraId || sourceId || 'CAM-01'

    const inferenceUrl = env.INFERENCE_SERVICE_URL || 'http://127.0.0.1:8000'
    let pyResponse
    try {
      pyResponse = await fetch(`${inferenceUrl}/infer-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image,
          camera_id: targetCamId,
        }),
      })
    } catch (netErr) {
      return errorResponse(res, {
        statusCode: 503,
        message: `AI Inference Service unavailable at ${inferenceUrl}. Please ensure 'python src/inference_service.py' is running. (${netErr.message})`,
      })
    }

    if (!pyResponse.ok) {
      const errData = await pyResponse.json().catch(() => ({}))
      return errorResponse(res, {
        statusCode: pyResponse.status || 500,
        message: errData.error || 'Inference service returned an error.',
      })
    }

    const result = await pyResponse.json()
    return successResponse(res, {
      message: 'Inference completed successfully',
      data: result,
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Execute a staged test scenario and dispatch detection
 */
export async function triggerScenario(req, res, next) {
  try {
    const { scenario = 6, cameraId = 'CAM-12' } = req.body
    const inferenceUrl = env.INFERENCE_SERVICE_URL || 'http://127.0.0.1:8000'

    let pyResponse
    try {
      pyResponse = await fetch(`${inferenceUrl}/trigger-scenario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: Number(scenario), camera_id: cameraId }),
      })
    } catch (netErr) {
      return errorResponse(res, {
        statusCode: 503,
        message: `AI Inference Service unavailable at ${inferenceUrl}. Please ensure 'python src/inference_service.py' is running. (${netErr.message})`,
      })
    }

    const result = await pyResponse.json()
    return successResponse(res, {
      message: `Scenario ${scenario} executed successfully`,
      data: result,
    })
  } catch (err) {
    next(err)
  }
}

/**
 * Start live camera streaming in background worker
 */
export async function startCameraStream(req, res) {
  try {
    const inferenceUrl = env.INFERENCE_SERVICE_URL || 'http://127.0.0.1:8000'
    const pyResponse = await fetch(`${inferenceUrl}/start-camera`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch((err) => {
      throw new Error(`Inference service unavailable (${err.message})`)
    })
    const data = await pyResponse.json()
    return successResponse(res, { data })
  } catch (err) {
    return errorResponse(res, {
      statusCode: 503,
      message: err.message,
    })
  }
}

/**
 * Stop live camera streaming worker
 */
export async function stopCameraStream(req, res) {
  try {
    const inferenceUrl = env.INFERENCE_SERVICE_URL || 'http://127.0.0.1:8000'
    const pyResponse = await fetch(`${inferenceUrl}/stop-camera`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch((err) => {
      throw new Error(`Inference service unavailable (${err.message})`)
    })
    const data = await pyResponse.json()
    return successResponse(res, { data })
  } catch (err) {
    return errorResponse(res, {
      statusCode: 503,
      message: err.message,
    })
  }
}
