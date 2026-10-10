import { User } from '../models/User.js'
import { successResponse, errorResponse } from '../utils/apiResponse.js'

export async function listUsers(req, res, next) {
  try {
    const { role, department, search } = req.query
    const query = {}

    if (role) query.role = role
    if (department) query.department = department
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
      ]
    }

    const users = await User.find(query).sort({ createdAt: -1 })

    return successResponse(res, {
      message: 'Users retrieved successfully.',
      data: { users },
      meta: { total: users.length },
    })
  } catch (err) {
    next(err)
  }
}

export async function getUserById(req, res, next) {
  try {
    const user = await User.findById(req.params.id)
    if (!user) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'User not found.',
      })
    }

    return successResponse(res, {
      message: 'User details.',
      data: { user },
    })
  } catch (err) {
    next(err)
  }
}

export async function updateUserStatus(req, res, next) {
  try {
    const { isActive } = req.body
    if (typeof isActive !== 'boolean') {
      return errorResponse(res, {
        statusCode: 400,
        message: "'isActive' must be a boolean value.",
      })
    }

    const user = await User.findById(req.params.id)
    if (!user) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'User not found.',
      })
    }

    // Prevent deactivating own admin account
    if (user._id.toString() === req.user._id.toString() && !isActive) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'You cannot deactivate your own administrative account.',
      })
    }

    user.isActive = isActive
    if (!isActive) {
      user.refreshTokenHash = null
    }
    await user.save()

    return successResponse(res, {
      message: `User '${user.name}' has been ${isActive ? 'activated' : 'deactivated'}.`,
      data: { user },
    })
  } catch (err) {
    next(err)
  }
}
