import { Sensor } from '../models/Sensor.js'
import { successResponse, errorResponse } from '../utils/apiResponse.js'

export async function listSensors(req, res, next) {
  try {
    const { status, severity } = req.query
    const query = {}

    if (status) query.status = status
    if (severity) query.severity = severity

    const sensors = await Sensor.find(query).sort({ sensorId: 1 })

    return successResponse(res, {
      message: 'Sensors retrieved successfully.',
      data: {
        sensors,
        total: sensors.length,
        tamperedCount: sensors.filter((s) => s.status.toLowerCase().includes('tamper')).length,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function getSensorById(req, res, next) {
  try {
    const { id } = req.params
    const query = id.includes('-') ? { sensorId: id.toUpperCase() } : { _id: id }
    const sensor = await Sensor.findOne(query)

    if (!sensor) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Sensor not found.',
      })
    }

    return successResponse(res, {
      message: 'Sensor details retrieved.',
      data: { sensor },
    })
  } catch (err) {
    next(err)
  }
}

export async function createSensor(req, res, next) {
  try {
    const { sensorId, name, type, location, status, health, issue, lastPing, severity } = req.body

    if (!sensorId || !name || !type || !location) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'sensorId, name, type, and location are required fields.',
      })
    }

    const existing = await Sensor.findOne({ sensorId: sensorId.toUpperCase() })
    if (existing) {
      return errorResponse(res, {
        statusCode: 409,
        message: `Sensor with ID '${sensorId.toUpperCase()}' already exists.`,
      })
    }

    const sensor = await Sensor.create({
      sensorId: sensorId.toUpperCase(),
      name,
      type,
      location,
      status: status || 'Normal',
      health: health || '100%',
      issue: issue || 'None · Standard operations',
      lastPing: lastPing || 'Just now',
      severity: severity || 'Low',
    })

    return successResponse(res, {
      statusCode: 201,
      message: `Sensor '${sensor.sensorId}' registered successfully.`,
      data: { sensor },
    })
  } catch (err) {
    next(err)
  }
}

export async function updateSensorStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status, issue, health, lastPing, severity } = req.body
    const query = id.includes('-') ? { sensorId: id.toUpperCase() } : { _id: id }

    const sensor = await Sensor.findOne(query)
    if (!sensor) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Sensor not found.',
      })
    }

    if (status !== undefined) sensor.status = status
    if (issue !== undefined) sensor.issue = issue
    if (health !== undefined) sensor.health = health
    if (lastPing !== undefined) sensor.lastPing = lastPing
    if (severity !== undefined) sensor.severity = severity

    await sensor.save()

    return successResponse(res, {
      message: `Sensor '${sensor.sensorId}' status updated.`,
      data: { sensor },
    })
  } catch (err) {
    next(err)
  }
}
