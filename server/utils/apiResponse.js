export function successResponse(
  res,
  { statusCode = 200, message = 'Success', data = null, meta = null } = {},
) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    meta,
  })
}

export function errorResponse(
  res,
  { statusCode = 500, message = 'An error occurred', errors = null } = {},
) {
  return res.status(statusCode).json({
    success: false,
    message,
    errors,
  })
}
