import { Router } from 'express'
import {
  createIncident,
  listIncidents,
  getIncidentById,
  acknowledgeIncident,
  updateIncidentStatus,
  assignIncident,
  resolveIncident,
  escalateIncident,
} from '../controllers/incidentController.js'
import { authenticateToken } from '../middleware/authMiddleware.js'
import { validateBody } from '../middleware/validateMiddleware.js'
import {
  createIncidentSchema,
  updateStatusSchema,
  assignIncidentSchema,
  resolveIncidentSchema,
  escalateIncidentSchema,
} from '../validators/incidentValidator.js'

const router = Router()

// All incident routes require a verified JWT Bearer token
router.use(authenticateToken)

// Incident CRUD and lifecycle endpoints
router.route('/')
  .get(listIncidents)
  .post(validateBody(createIncidentSchema), createIncident)

router.route('/:id')
  .get(getIncidentById)

router.patch('/:id/acknowledge', acknowledgeIncident)
router.patch('/:id/status', validateBody(updateStatusSchema), updateIncidentStatus)
router.patch('/:id/assign', validateBody(assignIncidentSchema), assignIncident)
router.patch('/:id/resolve', validateBody(resolveIncidentSchema), resolveIncident)
router.post('/:id/escalate', validateBody(escalateIncidentSchema), escalateIncident)

export default router
