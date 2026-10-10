import { errorResponse } from '../utils/apiResponse.js'

export function validateBody(schema) {
  return (req, res, next) => {
    const parseResult = schema.safeParse(req.body)
    if (!parseResult.success) {
      const formattedErrors = parseResult.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }))

      return errorResponse(res, {
        statusCode: 400,
        message: 'Validation failed',
        errors: formattedErrors,
      })
    }

    req.body = parseResult.data
    next()
  }
}
