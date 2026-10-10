import { verifyAccessToken } from '../utils/tokenUtils.js'
import { User } from '../models/User.js'
import { errorResponse } from '../utils/apiResponse.js'

export async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Authentication required. Bearer token missing.',
      })
    }

    const token = authHeader.split(' ')[1]

    let decoded
    try {
      decoded = verifyAccessToken(token)
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return errorResponse(res, {
          statusCode: 401,
          message: 'Authentication token has expired. Please refresh your session.',
        })
      }
      return errorResponse(res, {
        statusCode: 401,
        message: 'Invalid authentication token.',
      })
    }

    const user = await User.findById(decoded.userId)
    if (!user) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'User account not found.',
      })
    }

    if (!user.isActive) {
      return errorResponse(res, {
        statusCode: 403,
        message: 'This account has been deactivated.',
      })
    }

    req.user = user
    next()
  } catch (err) {
    next(err)
  }
}

export function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Authentication required.',
      })
    }

    if (!allowedRoles.includes(req.user.role)) {
      return errorResponse(res, {
        statusCode: 403,
        message: `Forbidden: role '${req.user.role}' lacks permission for this resource.`,
        errors: {
          requiredRoles: allowedRoles,
          currentRole: req.user.role,
        },
      })
    }

    next()
  }
}
