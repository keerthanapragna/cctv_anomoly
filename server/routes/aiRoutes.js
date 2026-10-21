import { Router } from 'express'
import {
  ingestDetection,
  streamDetections,
  getAiStatus,
  inferImage,
  triggerScenario,
  startCameraStream,
  stopCameraStream,
} from '../controllers/aiController.js'
import { validateBody } from '../middleware/validateMiddleware.js'
import {
  aiDetectionSchema,
  testInferenceSchema,
  triggerScenarioSchema,
} from '../validators/aiValidator.js'

const router = Router()

// Ingestion endpoint (protected by INGEST_API_KEY)
router.post('/detection', validateBody(aiDetectionSchema), ingestDetection)

// Server-Sent Events stream for real-time dashboard notifications
router.get('/stream', streamDetections)

// AI subsystem status & statistics
router.get('/status', getAiStatus)

// Image inference endpoint (accepts base64 image and optional cameraId)
router.post('/infer-image', validateBody(testInferenceSchema), inferImage)

// Scenario trigger endpoint for verification / simulation
router.post('/scenario', validateBody(triggerScenarioSchema), triggerScenario)

// Camera stream control
router.post('/camera/start', startCameraStream)
router.post('/camera/stop', stopCameraStream)

export default router

