import { Router } from 'express'
import {
  bootstrapAdmin,
  register,
  login,
  refreshToken,
  logout,
  getMe,
} from '../controllers/authController.js'
import { authenticateToken, requireRoles } from '../middleware/authMiddleware.js'
import { validateBody } from '../middleware/validateMiddleware.js'
import {
  loginSchema,
  registerSchema,
  bootstrapAdminSchema,
} from '../validators/authValidator.js'
import { ROLES } from '../config/constants.js'
import { successResponse } from '../utils/apiResponse.js'
import rateLimit from 'express-rate-limit'

const router = Router()

// Rate limiter for login requests to protect against brute-force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 100 : 15, // Higher headroom in development
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: {
    success: false,
    message: 'Too many login attempts. Please try again after 15 minutes.',
  },
})

// Public Auth Endpoints
router.post('/bootstrap-admin', validateBody(bootstrapAdminSchema), bootstrapAdmin)
router.post('/login', loginLimiter, validateBody(loginSchema), login)
router.post('/refresh', refreshToken)
router.post('/logout', logout)

// Authenticated Endpoints
router.get('/me', authenticateToken, getMe)

// Admin-Only Provisioning Endpoint
router.post(
  '/register',
  authenticateToken,
  requireRoles(ROLES.ADMIN),
  validateBody(registerSchema),
  register,
)

// Dedicated Role-Verification Endpoints (for automated testing and client validation)
router.get(
  '/test/admin-only',
  authenticateToken,
  requireRoles(ROLES.ADMIN),
  (req, res) => {
    return successResponse(res, {
      message: 'Access granted to Administrator.',
      data: { user: req.user },
    })
  },
)

router.get(
  '/test/security-only',
  authenticateToken,
  requireRoles(ROLES.ADMIN, ROLES.SECURITY_OFFICER),
  (req, res) => {
    return successResponse(res, {
      message: 'Access granted to Security Officer or Admin.',
      data: { user: req.user },
    })
  },
)

router.get(
  '/test/higher-authority-only',
  authenticateToken,
  requireRoles(ROLES.ADMIN, ROLES.HIGHER_AUTHORITY),
  (req, res) => {
    return successResponse(res, {
      message: 'Access granted to Higher Authority or Admin.',
      data: { user: req.user },
    })
  },
)

export default router
