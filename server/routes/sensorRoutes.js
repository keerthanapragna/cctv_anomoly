import { Router } from 'express'
import {
  listSensors,
  getSensorById,
  createSensor,
  updateSensorStatus,
} from '../controllers/sensorController.js'
import { authenticateToken, requireRoles } from '../middleware/authMiddleware.js'
import { ROLES } from '../config/constants.js'

const router = Router()

// Sensor routes require authenticated user
router.use(authenticateToken)

router.get('/', listSensors)
router.get('/:id', getSensorById)

// Creating and updating sensors allowed for Admin and Security Officer
router.post(
  '/',
  requireRoles(ROLES.ADMIN, ROLES.SECURITY_OFFICER),
  createSensor,
)

router.patch(
  '/:id',
  requireRoles(ROLES.ADMIN, ROLES.SECURITY_OFFICER),
  updateSensorStatus,
)

export default router
