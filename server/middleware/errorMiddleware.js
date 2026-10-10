import { errorResponse } from '../utils/apiResponse.js'
import { env } from '../config/env.js'

export function notFoundHandler(req, res) {
  return errorResponse(res, {
    statusCode: 404,
    message: `Resource not found: ${req.method} ${req.originalUrl}`,
  })
}

export function errorHandler(err, req, res, next) {
  // If response headers already sent, delegate to default Express handler
  if (res.headersSent) {
    return next(err)
  }

  const statusCode = err.statusCode || (err.name === 'ValidationError' ? 400 : 500)
  const message = err.message || 'Internal server error'

  const responsePayload = {
    statusCode,
    message,
    errors: err.errors || null,
  }

  // Include stack trace only in development
  if (env.NODE_ENV === 'development') {
    responsePayload.stack = err.stack
  }

  console.error(`[Error] ${req.method} ${req.originalUrl} - ${statusCode}: ${message}`)
  if (statusCode === 500 && err.stack) {
    console.error(err.stack)
  }

  return errorResponse(res, responsePayload)
}
