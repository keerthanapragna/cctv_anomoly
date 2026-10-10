import { Incident } from '../models/Incident.js'
import { ROLES, INCIDENT_STATUSES, SLA_THRESHOLDS_MINUTES } from '../config/constants.js'
import { successResponse, errorResponse } from '../utils/apiResponse.js'

// Helper: Check if a specific user can view/access an incident
export function canUserAccessIncident(user, incident) {
  if (user.role === ROLES.ADMIN) return true

  if (user.role === ROLES.SECURITY_OFFICER) {
    return (
      incident.severity === 'Critical' ||
      incident.department === 'Central Physical Security' ||
      (incident.assignedTo && incident.assignedTo.toString() === user._id.toString()) ||
      incident.assignedOfficer === user.name ||
      incident.assigneeLabel === 'Campus Security'
    )
  }

  if (user.role === ROLES.FACULTY_STAFF) {
    return (
      incident.department === user.department ||
      (incident.assignedTo && incident.assignedTo.toString() === user._id.toString()) ||
      incident.assignedStaff === user.name
    )
  }

  if (user.role === ROLES.DEPT_HEAD) {
    return (
      incident.department === user.department ||
      (incident.severity === 'Critical' &&
        incident.location?.rawText?.toLowerCase().includes(user.department.toLowerCase()))
    )
  }

  if (user.role === ROLES.HIGHER_AUTHORITY) {
    return incident.isEscalated === true || incident.severity === 'Critical'
  }

  return false
}

// Allowed state transitions
const VALID_TRANSITIONS = {
  [INCIDENT_STATUSES.NEW]: [
    INCIDENT_STATUSES.ASSIGNED,
    INCIDENT_STATUSES.INVESTIGATING,
    INCIDENT_STATUSES.CLOSED,
  ],
  [INCIDENT_STATUSES.ASSIGNED]: [
    INCIDENT_STATUSES.INVESTIGATING,
    INCIDENT_STATUSES.UNDER_REVIEW,
    INCIDENT_STATUSES.RESOLVED,
  ],
  [INCIDENT_STATUSES.INVESTIGATING]: [
    INCIDENT_STATUSES.UNDER_REVIEW,
    INCIDENT_STATUSES.RESOLVED,
    INCIDENT_STATUSES.ASSIGNED,
  ],
  [INCIDENT_STATUSES.UNDER_REVIEW]: [
    INCIDENT_STATUSES.INVESTIGATING,
    INCIDENT_STATUSES.RESOLVED,
    INCIDENT_STATUSES.CLOSED,
  ],
  [INCIDENT_STATUSES.RESOLVED]: [
    INCIDENT_STATUSES.CLOSED,
    INCIDENT_STATUSES.INVESTIGATING,
  ],
  [INCIDENT_STATUSES.CLOSED]: [INCIDENT_STATUSES.INVESTIGATING],
}

// 1. Create Incident
export async function createIncident(req, res, next) {
  try {
    const user = req.user
    const {
      title,
      description,
      hazardCategory,
      severity,
      location,
      department: reqDept,
      source,
      sensor,
      notes,
    } = req.body

    // Authorization check on creation
    if (user.role === ROLES.HIGHER_AUTHORITY) {
      return errorResponse(res, {
        statusCode: 403,
        message: 'Higher Authority oversees governance and does not file routine incident dispatches.',
      })
    }

    // Faculty cannot report on behalf of another department
    let department = reqDept || user.department
    if (user.role === ROLES.FACULTY_STAFF && reqDept && reqDept !== user.department) {
      department = user.department
    }

    // Format location object
    let locationObj
    if (typeof location === 'string') {
      const parts = location.split('·').map((s) => s.trim())
      locationObj = {
        building: parts[0] || 'Main Campus',
        floor: parts[1] || '',
        zone: parts[2] || '',
        rawText: location,
      }
    } else {
      locationObj = {
        building: location.building || 'Main Campus',
        floor: location.floor || '',
        zone: location.zone || '',
        rawText: location.rawText || location.building || 'Campus Zone',
      }
    }

    // Generate unique sequential Incident ID
    const year = new Date().getFullYear()
    const count = await Incident.countDocuments()
    const incidentId = `INC-${year}-${String(140 + count + 1).padStart(4, '0')}`

    const slaMins = SLA_THRESHOLDS_MINUTES[severity]?.acknowledge || 120
    const deadlineStr = slaMins <= 30 ? `${slaMins} mins (Urgent)` : `${Math.round(slaMins / 60)} hours`

    const incident = await Incident.create({
      incidentId,
      title,
      description: description || '',
      hazardCategory,
      severity,
      location: locationObj,
      department,
      status: INCIDENT_STATUSES.NEW,
      source: source || 'MANUAL',
      reportedBy: user._id,
      assigneeLabel: user.role === ROLES.SECURITY_OFFICER ? 'Campus Security' : 'Pending Triage',
      assignedOfficer: user.role === ROLES.SECURITY_OFFICER ? user.name : null,
      assignedStaff: user.role === ROLES.FACULTY_STAFF ? user.name : null,
      deadline: deadlineStr,
      evidenceMetadata: {
        sensorId: sensor || '',
        sensorStatus: sensor ? 'Active Alert' : '',
        snapshotUrl: '',
        tamperFlags: [],
      },
      notes: notes || `Reported by ${user.name} (${user.role})`,
    })

    return successResponse(res, {
      statusCode: 201,
      message: `Incident ${incident.incidentId} registered successfully.`,
      data: { incident },
    })
  } catch (err) {
    next(err)
  }
}

// 2. List Incidents (Strict Role Scoping)
export async function listIncidents(req, res, next) {
  try {
    const user = req.user
    const { status, severity, hazardCategory, search } = req.query

    // Construct role-scoped filter
    let roleQuery = {}
    if (user.role === ROLES.ADMIN) {
      roleQuery = {}
    } else if (user.role === ROLES.SECURITY_OFFICER) {
      roleQuery = {
        $or: [
          { severity: 'Critical' },
          { department: 'Central Physical Security' },
          { assignedTo: user._id },
          { assignedOfficer: user.name },
          { assigneeLabel: 'Campus Security' },
        ],
      }
    } else if (user.role === ROLES.FACULTY_STAFF) {
      roleQuery = {
        $or: [
          { department: user.department },
          { assignedTo: user._id },
          { assignedStaff: user.name },
        ],
      }
    } else if (user.role === ROLES.DEPT_HEAD) {
      roleQuery = { department: user.department }
    } else if (user.role === ROLES.HIGHER_AUTHORITY) {
      roleQuery = {
        $or: [{ isEscalated: true }, { severity: 'Critical' }],
      }
    }

    const query = { ...roleQuery }

    if (status && status !== 'ALL') {
      query.status = status
    }
    if (severity) {
      query.severity = severity
    }
    if (hazardCategory) {
      query.hazardCategory = hazardCategory
    }
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { incidentId: { $regex: search, $options: 'i' } },
        { 'location.rawText': { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
      ]
    }

    const incidents = await Incident.find(query)
      .populate('reportedBy', 'name email role department')
      .populate('assignedTo', 'name email role department')
      .sort({ createdAt: -1 })

    return successResponse(res, {
      message: 'Incidents retrieved successfully.',
      data: {
        incidents,
        total: incidents.length,
        scopedRole: user.role,
        departmentScope: user.department,
      },
    })
  } catch (err) {
    next(err)
  }
}

// 3. Get Incident Details
export async function getIncidentById(req, res, next) {
  try {
    const { id } = req.params
    const query = id.startsWith('INC-') ? { incidentId: id.toUpperCase() } : { _id: id }

    const incident = await Incident.findOne(query)
      .populate('reportedBy', 'name email role department')
      .populate('assignedTo', 'name email role department')
      .populate('acknowledgedBy', 'name role')
      .populate('resolvedBy', 'name role')

    if (!incident) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Incident record not found.',
      })
    }

    // Role-authorization check on single record retrieval
    if (!canUserAccessIncident(req.user, incident)) {
      return errorResponse(res, {
        statusCode: 403,
        message: `Forbidden: Incident '${incident.incidentId}' is outside your authorized role and department scope.`,
      })
    }

    return successResponse(res, {
      message: 'Incident details retrieved.',
      data: { incident },
    })
  } catch (err) {
    next(err)
  }
}

// 4. Acknowledge Incident
export async function acknowledgeIncident(req, res, next) {
  try {
    const { id } = req.params
    const query = id.startsWith('INC-') ? { incidentId: id.toUpperCase() } : { _id: id }

    const incident = await Incident.findOne(query)
    if (!incident) {
      return errorResponse(res, { statusCode: 404, message: 'Incident not found.' })
    }

    if (!canUserAccessIncident(req.user, incident)) {
      return errorResponse(res, {
        statusCode: 403,
        message: 'Forbidden: You cannot acknowledge an incident outside your scope.',
      })
    }

    if (incident.status === INCIDENT_STATUSES.RESOLVED || incident.status === INCIDENT_STATUSES.CLOSED) {
      return errorResponse(res, {
        statusCode: 400,
        message: `Cannot acknowledge an incident that is already ${incident.status}.`,
      })
    }

    incident.status = INCIDENT_STATUSES.ASSIGNED
    incident.acknowledgedAt = new Date()
    incident.acknowledgedBy = req.user._id
    if (!incident.assignedOfficer && req.user.role === ROLES.SECURITY_OFFICER) {
      incident.assignedOfficer = req.user.name
      incident.assigneeLabel = 'Campus Security'
    }
    if (!incident.assignedStaff && req.user.role === ROLES.FACULTY_STAFF) {
      incident.assignedStaff = req.user.name
    }

    await incident.save()

    return successResponse(res, {
      message: `Incident ${incident.incidentId} acknowledged by ${req.user.name}.`,
      data: { incident },
    })
  } catch (err) {
    next(err)
  }
}

// 5. Update Incident Status
export async function updateIncidentStatus(req, res, next) {
  try {
    const { id } = req.params
    const { status: newStatus, notes } = req.body
    const query = id.startsWith('INC-') ? { incidentId: id.toUpperCase() } : { _id: id }

    const incident = await Incident.findOne(query)
    if (!incident) {
      return errorResponse(res, { statusCode: 404, message: 'Incident not found.' })
    }

    if (!canUserAccessIncident(req.user, incident)) {
      return errorResponse(res, {
        statusCode: 403,
        message: 'Forbidden: You lack permission to update this incident.',
      })
    }

    // Verify authorized transition
    const allowedNext = VALID_TRANSITIONS[incident.status] || []
    if (!allowedNext.includes(newStatus)) {
      return errorResponse(res, {
        statusCode: 400,
        message: `Invalid state transition from '${incident.status}' to '${newStatus}'. Allowed: [${allowedNext.join(', ')}].`,
      })
    }

    // Role restrictions on closed status
    if (newStatus === INCIDENT_STATUSES.CLOSED && req.user.role !== ROLES.ADMIN && req.user.role !== ROLES.DEPT_HEAD) {
      return errorResponse(res, {
        statusCode: 403,
        message: 'Only Administrators and Department Heads can close incident records.',
      })
    }

    incident.status = newStatus
    if (notes) {
      incident.notes = `${incident.notes ? incident.notes + ' ' : ''}[Status updated to ${newStatus} by ${req.user.name}: ${notes}]`
    }
    await incident.save()

    return successResponse(res, {
      message: `Incident ${incident.incidentId} status updated to ${newStatus}.`,
      data: { incident },
    })
  } catch (err) {
    next(err)
  }
}

// 6. Assign / Reassign Incident
export async function assignIncident(req, res, next) {
  try {
    const user = req.user
    const { id } = req.params
    const { assignedTo, assignedOfficer, assignedStaff, assigneeLabel, department } = req.body

    // Permission: Only Admin, Security Officer, and Dept Head can assign
    if (
      user.role !== ROLES.ADMIN &&
      user.role !== ROLES.SECURITY_OFFICER &&
      user.role !== ROLES.DEPT_HEAD
    ) {
      return errorResponse(res, {
        statusCode: 403,
        message: 'Forbidden: Faculty Staff cannot reassign incidents.',
      })
    }

    const query = id.startsWith('INC-') ? { incidentId: id.toUpperCase() } : { _id: id }
    const incident = await Incident.findOne(query)
    if (!incident) {
      return errorResponse(res, { statusCode: 404, message: 'Incident not found.' })
    }

    // Dept Head can only reassign within their own department
    if (user.role === ROLES.DEPT_HEAD && incident.department !== user.department) {
      return errorResponse(res, {
        statusCode: 403,
        message: `Forbidden: Department Heads can only reassign incidents within '${user.department}'.`,
      })
    }

    if (assignedTo !== undefined) incident.assignedTo = assignedTo || null
    if (assignedOfficer !== undefined) incident.assignedOfficer = assignedOfficer || null
    if (assignedStaff !== undefined) incident.assignedStaff = assignedStaff || null
    if (assigneeLabel !== undefined) incident.assigneeLabel = assigneeLabel || 'Campus Security'
    if (department && user.role === ROLES.ADMIN) incident.department = department

    incident.status = INCIDENT_STATUSES.ASSIGNED
    await incident.save()

    return successResponse(res, {
      message: `Incident ${incident.incidentId} assigned successfully.`,
      data: { incident },
    })
  } catch (err) {
    next(err)
  }
}

// 7. Resolve Incident
export async function resolveIncident(req, res, next) {
  try {
    const { id } = req.params
    const { resolutionDetails } = req.body
    const query = id.startsWith('INC-') ? { incidentId: id.toUpperCase() } : { _id: id }

    const incident = await Incident.findOne(query)
    if (!incident) {
      return errorResponse(res, { statusCode: 404, message: 'Incident not found.' })
    }

    if (!canUserAccessIncident(req.user, incident)) {
      return errorResponse(res, {
        statusCode: 403,
        message: 'Forbidden: You cannot resolve an incident outside your scope.',
      })
    }

    incident.status = INCIDENT_STATUSES.RESOLVED
    incident.resolvedAt = new Date()
    incident.resolvedBy = req.user._id
    incident.resolutionDetails = resolutionDetails
    incident.isOverdue = false
    incident.deadline = 'Resolved'

    await incident.save()

    return successResponse(res, {
      message: `Incident ${incident.incidentId} resolved successfully.`,
      data: { incident },
    })
  } catch (err) {
    next(err)
  }
}

// 8. Escalate Incident
export async function escalateIncident(req, res, next) {
  try {
    const user = req.user
    const { id } = req.params
    const { escalationTier, reason } = req.body
    const query = id.startsWith('INC-') ? { incidentId: id.toUpperCase() } : { _id: id }

    const incident = await Incident.findOne(query)
    if (!incident) {
      return errorResponse(res, { statusCode: 404, message: 'Incident not found.' })
    }

    if (!canUserAccessIncident(user, incident)) {
      return errorResponse(res, {
        statusCode: 403,
        message: 'Forbidden: You cannot escalate an incident outside your scope.',
      })
    }

    // Role hierarchy escalation checks
    if (user.role === ROLES.FACULTY_STAFF && escalationTier?.includes('Tier 2')) {
      return errorResponse(res, {
        statusCode: 403,
        message: 'Faculty staff can only escalate to Tier 1 (Department Head).',
      })
    }

    incident.isEscalated = true
    incident.escalationTier = escalationTier
    incident.escalatedAt = new Date()
    incident.escalatedBy = user._id
    if (reason) {
      incident.notes = `${incident.notes ? incident.notes + ' ' : ''}[Escalated by ${user.name} to ${escalationTier}: ${reason}]`
    }

    await incident.save()

    return successResponse(res, {
      message: `Incident ${incident.incidentId} escalated to ${escalationTier}.`,
      data: { incident },
    })
  } catch (err) {
    next(err)
  }
}
