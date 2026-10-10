import { User } from '../models/User.js'
import { ROLES } from '../config/constants.js'
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  getRefreshCookieOptions,
} from '../utils/tokenUtils.js'
import { successResponse, errorResponse } from '../utils/apiResponse.js'

export async function bootstrapAdmin(req, res, next) {
  try {
    const existingAdminCount = await User.countDocuments({ role: ROLES.ADMIN })
    if (existingAdminCount > 0) {
      return errorResponse(res, {
        statusCode: 403,
        message: 'System bootstrap is disabled: an Administrator already exists.',
      })
    }

    const { name, email, password, department, phone } = req.body

    const existingUser = await User.findOne({ email: email.toLowerCase() })
    if (existingUser) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'A user with this email address already exists.',
      })
    }

    const passwordHash = await User.hashPassword(password)

    const admin = new User({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: ROLES.ADMIN,
      department: department || 'Campus Safety Administration',
      phone: phone || '',
      isActive: true,
      lastLoginAt: new Date(),
    })

    const accessToken = generateAccessToken(admin)
    const refreshToken = generateRefreshToken(admin)

    admin.refreshTokenHash = await User.hashRefreshToken(refreshToken)
    await admin.save()

    res.cookie('refreshToken', refreshToken, getRefreshCookieOptions())

    return successResponse(res, {
      statusCode: 201,
      message: 'Initial Administrator provisioned successfully.',
      data: {
        user: admin,
        accessToken,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function register(req, res, next) {
  try {
    const { name, email, password, role, department, phone } = req.body

    const existingUser = await User.findOne({ email: email.toLowerCase() })
    if (existingUser) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'A user with this email already exists.',
      })
    }

    const passwordHash = await User.hashPassword(password)

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role,
      department,
      phone: phone || '',
      isActive: true,
    })

    return successResponse(res, {
      statusCode: 201,
      message: `User '${user.name}' created successfully with role '${user.role}'.`,
      data: { user },
    })
  } catch (err) {
    next(err)
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+passwordHash +refreshTokenHash',
    )

    if (!user) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Invalid email or password.',
      })
    }

    if (!user.isActive) {
      return errorResponse(res, {
        statusCode: 403,
        message: 'Your account has been deactivated. Please contact campus security.',
      })
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Invalid email or password.',
      })
    }

    user.lastLoginAt = new Date()
    const accessToken = generateAccessToken(user)
    const refreshToken = generateRefreshToken(user)

    user.refreshTokenHash = await User.hashRefreshToken(refreshToken)
    await user.save()

    res.cookie('refreshToken', refreshToken, getRefreshCookieOptions())

    return successResponse(res, {
      message: 'Login successful.',
      data: {
        user,
        accessToken,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function refreshToken(req, res, next) {
  try {
    const rawToken = req.cookies?.refreshToken || req.body?.refreshToken

    if (!rawToken) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Refresh token not found. Please log in.',
      })
    }

    let decoded
    try {
      decoded = verifyRefreshToken(rawToken)
    } catch {
      return errorResponse(res, {
        statusCode: 401,
        message: 'Invalid or expired refresh token. Please log in again.',
      })
    }

    const user = await User.findById(decoded.userId).select('+refreshTokenHash')
    if (!user || !user.isActive) {
      return errorResponse(res, {
        statusCode: 401,
        message: 'User session no longer valid.',
      })
    }

    const isValid = await user.compareRefreshToken(rawToken)
    if (!isValid) {
      // Possible token reuse or rotation conflict: invalidate existing session
      user.refreshTokenHash = null
      await user.save()
      res.clearCookie('refreshToken', getRefreshCookieOptions())

      return errorResponse(res, {
        statusCode: 401,
        message: 'Invalid refresh token session. Please log in again.',
      })
    }

    // Token rotation: Issue new access token AND new refresh token
    const newAccessToken = generateAccessToken(user)
    const newRefreshToken = generateRefreshToken(user)

    user.refreshTokenHash = await User.hashRefreshToken(newRefreshToken)
    await user.save()

    res.cookie('refreshToken', newRefreshToken, getRefreshCookieOptions())

    return successResponse(res, {
      message: 'Session token refreshed.',
      data: {
        accessToken: newAccessToken,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function logout(req, res, next) {
  try {
    const rawToken = req.cookies?.refreshToken || req.body?.refreshToken

    if (rawToken) {
      try {
        const decoded = verifyRefreshToken(rawToken)
        if (decoded?.userId) {
          await User.findByIdAndUpdate(decoded.userId, { refreshTokenHash: null })
        }
      } catch {
        // Token verification failed during logout; proceed to clear cookie
      }
    }

    res.clearCookie('refreshToken', getRefreshCookieOptions())

    return successResponse(res, {
      message: 'Logged out successfully.',
    })
  } catch (err) {
    next(err)
  }
}

export async function getMe(req, res) {
  return successResponse(res, {
    message: 'Current user profile.',
    data: {
      user: req.user,
    },
  })
}
