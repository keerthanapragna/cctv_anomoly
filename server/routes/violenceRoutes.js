import { Router } from 'express'
import multer from 'multer'
import {
  getViolenceStatus,
  analyzeVideoUpload,
  analyzeFrameSequence,
  startCctvMonitoring,
  stopCctvMonitoring,
  getCctvStatus,
  ingestCctvDetection,
} from '../controllers/violenceController.js'
import { authenticateToken, requireRoles } from '../middleware/authMiddleware.js'
import { validateBody } from '../middleware/validateMiddleware.js'
import {
  analyzeFramesSchema,
  cctvStartSchema,
  violenceIngestSchema,
} from '../validators/violenceValidator.js'
import { ROLES } from '../config/constants.js'

const router = Router()

// Configure Multer for video uploads in memory with 100MB limit
const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.avi', '.mov', '.mkv', '.webm']
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'))
    if (allowed.includes(ext) || file.mimetype.startsWith('video/')) {
      cb(null, true)
    } else {
      cb(new Error(`Unsupported video format '${ext}'. Supported formats: ${allowed.join(', ')}`))
    }
  },
})

// 1. Health & status endpoint
router.get('/status', getViolenceStatus)

// 2. Video file analysis (offline / recorded file upload)
router.post(
  '/analyze-video',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message,
        })
      }
      next()
    })
  },
  analyzeVideoUpload,
)

// 3. Temporal frame sequence analysis (live webcam browser sampler)
router.post('/analyze-frames', validateBody(analyzeFramesSchema), analyzeFrameSequence)

// 4. CCTV RTSP Stream controls (Restricted to ADMIN & SECURITY_OFFICER)
router.post(
  '/cctv/start',
  authenticateToken,
  requireRoles(ROLES.ADMIN, ROLES.SECURITY_OFFICER),
  validateBody(cctvStartSchema),
  startCctvMonitoring,
)

router.post(
  '/cctv/stop',
  authenticateToken,
  requireRoles(ROLES.ADMIN, ROLES.SECURITY_OFFICER),
  stopCctvMonitoring,
)

router.get('/cctv/status', getCctvStatus)

// 5. Ingest alert from background worker (Protected by x-ingest-api-key)
router.post('/ingest', validateBody(violenceIngestSchema), ingestCctvDetection)

export default router
