import { Router } from 'express'
import {
  listUsers,
  getUserById,
  updateUserStatus,
} from '../controllers/userController.js'
import { authenticateToken, requireRoles } from '../middleware/authMiddleware.js'
import { ROLES } from '../config/constants.js'

const router = Router()

// All user routes require authentication
router.use(authenticateToken)

// List users (Admin, Security Officer, Dept Head can view authorized personnel)
router.get(
  '/',
  requireRoles(ROLES.ADMIN, ROLES.SECURITY_OFFICER, ROLES.DEPT_HEAD),
  listUsers,
)

// Get single user by ID
router.get('/:id', getUserById)

// Update user active status (Admin only)
router.patch(
  '/:id/status',
  requireRoles(ROLES.ADMIN),
  updateUserStatus,
)

export default router
