import { Router } from 'express'
import {
  listDirectives,
  createDirective,
} from '../controllers/directiveController.js'
import { authenticateToken, requireRoles } from '../middleware/authMiddleware.js'
import { ROLES } from '../config/constants.js'

const router = Router()

// All directive routes require authentication
router.use(authenticateToken)

// View directives (All authenticated personnel can view institutional directives)
router.get('/', listDirectives)

// Issuing directives: Higher Authority or Admin
router.post(
  '/',
  requireRoles(ROLES.HIGHER_AUTHORITY, ROLES.ADMIN),
  createDirective,
)

export default router
