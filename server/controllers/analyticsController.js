import { Incident } from '../models/Incident.js'
import { User } from '../models/User.js'
import { ROLES, SLA_THRESHOLDS_MINUTES, INCIDENT_STATUSES } from '../config/constants.js'
import { successResponse, errorResponse } from '../utils/apiResponse.js'

/**
 * Format duration in seconds into human-readable string (e.g. "2 min 35 sec")
 */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds) || seconds < 0) {
    return 'N/A'
  }
  const sec = Math.round(seconds)
  if (sec < 60) {
    return `${sec} sec`
  }
  const mins = Math.floor(sec / 60)
  const remSec = sec % 60
  if (mins < 60) {
    return remSec > 0 ? `${mins} min ${remSec} sec` : `${mins} min`
  }
  const hours = (sec / 3600).toFixed(1)
  return `${hours} hrs`
}

/**
 * Enforce role-based access control and scoping for analytics queries
 */
export function buildAnalyticsScopeQuery(user) {
  if (user.role === ROLES.ADMIN || user.role === ROLES.HIGHER_AUTHORITY) {
    return {}
  }
  if (user.role === ROLES.DEPT_HEAD) {
    return { department: user.department }
  }
  if (user.role === ROLES.SECURITY_OFFICER) {
    return {
      $or: [
        { severity: 'Critical' },
        { department: 'Central Physical Security' },
        { assignedTo: user._id },
        { assignedOfficer: user.name },
        { assigneeLabel: 'Campus Security' },
      ],
    }
  }
  if (user.role === ROLES.FACULTY_STAFF) {
    return {
      $or: [
        { department: user.department },
        { assignedTo: user._id },
        { assignedStaff: user.name },
      ],
    }
  }
  return { _id: null }
}

/**
 * Build MongoDB filter query based on user permissions and requested filters
 */
export function buildFilterQuery(user, queryParams = {}) {
  const scopeQuery = buildAnalyticsScopeQuery(user)
  const filters = []

  if (Object.keys(scopeQuery).length > 0) {
    filters.push(scopeQuery)
  }

  const { range, days, startDate, endDate, severity, hazardCategory, role, person, department } = queryParams

  // Date range filter
  let start = null
  let end = null

  if (startDate) {
    start = new Date(startDate)
  } else if (range || days) {
    const d = parseInt(days || range?.replace('d', ''), 10)
    if (!isNaN(d) && d > 0) {
      start = new Date(Date.now() - d * 24 * 60 * 60 * 1000)
    }
  }

  if (endDate) {
    end = new Date(endDate)
  }

  if (start || end) {
    const dateQuery = {}
    if (start && !isNaN(start.getTime())) dateQuery.$gte = start
    if (end && !isNaN(end.getTime())) dateQuery.$lte = end
    filters.push({ detectedAt: dateQuery })
  }

  // Severity filter
  if (severity && severity !== 'ALL') {
    filters.push({ severity })
  }

  // Hazard Category filter
  if (hazardCategory && hazardCategory !== 'ALL') {
    filters.push({ hazardCategory })
  }

  // Department filter (allowed if Admin/Higher Authority or within user's department)
  if (department && department !== 'ALL') {
    if (user.role === ROLES.ADMIN || user.role === ROLES.HIGHER_AUTHORITY || user.department === department) {
      filters.push({ department })
    }
  }

  // Person filter
  if (person && person !== 'ALL') {
    filters.push({
      $or: [
        { assignedOfficer: person },
        { assignedStaff: person },
        { assigneeLabel: person },
      ],
    })
  }

  if (filters.length === 0) return {}
  if (filters.length === 1) return filters[0]
  return { $and: filters }
}

/**
 * Attribute an incident to one of the 5 roles using user records, assignee fields, and department rules
 */
export function resolveIncidentRole(incident, usersMap = new Map()) {
  if (incident.assignedTo) {
    const assignedUser = usersMap.get(incident.assignedTo.toString())
    if (assignedUser?.role && Object.values(ROLES).includes(assignedUser.role)) {
      return assignedUser.role
    }
  }

  if (incident.assignedOfficer || incident.assigneeLabel === 'Campus Security') {
    return ROLES.SECURITY_OFFICER
  }

  if (incident.assignedStaff) {
    for (const u of usersMap.values()) {
      if (u.name === incident.assignedStaff) {
        return u.role
      }
    }
    return ROLES.FACULTY_STAFF
  }

  if (incident.isEscalated && incident.escalationTier?.includes('Tier 2')) {
    return ROLES.HIGHER_AUTHORITY
  }

  if (incident.department === 'Central Physical Security') {
    return ROLES.SECURITY_OFFICER
  }
  if (incident.department === 'School of Engineering') {
    return ROLES.DEPT_HEAD
  }
  if (incident.department === 'Chemistry & Science Labs') {
    return ROLES.FACULTY_STAFF
  }

  return ROLES.ADMIN
}

/**
 * Calculate metrics for a collection of incidents based on strict rules:
 * - Acknowledgement response time = acknowledgedAt - detectedAt
 * - Resolution time = resolvedAt - detectedAt
 * - Assignment time = assignedAt - detectedAt
 * - Actual on-site response time = responseStartedAt - detectedAt (if responseStartedAt present)
 * - SLA compliance: eligible incidents acknowledged within SLA threshold / (all eligible incidents with valid ack or expired SLA) * 100
 * - Resolution rate: resolved / total assigned * 100
 */
export function calculateIncidentMetrics(incidents, now = new Date()) {
  let responseTimeSum = 0
  let responseTimeCount = 0

  let resolutionTimeSum = 0
  let resolutionTimeCount = 0

  let assignmentTimeSum = 0
  let assignmentTimeCount = 0

  let onSiteResponseTimeSum = 0
  let onSiteResponseTimeCount = 0

  let slaNumerator = 0
  let slaDenominator = 0

  let resolvedCount = 0
  let pendingCount = 0
  let incompleteRecordsCount = 0

  for (const inc of incidents) {
    const detected = inc.detectedAt ? new Date(inc.detectedAt) : null
    const acknowledged = inc.acknowledgedAt ? new Date(inc.acknowledgedAt) : null
    const assigned = inc.assignedAt ? new Date(inc.assignedAt) : null
    const responseStarted = inc.responseStartedAt ? new Date(inc.responseStartedAt) : null
    const resolved = inc.resolvedAt ? new Date(inc.resolvedAt) : null

    const isResolved = inc.status === INCIDENT_STATUSES.RESOLVED || inc.status === INCIDENT_STATUSES.CLOSED
    if (isResolved) {
      resolvedCount++
    } else {
      pendingCount++
    }

    if (!detected || isNaN(detected.getTime())) {
      incompleteRecordsCount++
      continue
    }

    // 1. Acknowledgement response time
    if (acknowledged && !isNaN(acknowledged.getTime())) {
      const diffMs = acknowledged.getTime() - detected.getTime()
      if (diffMs >= 0) {
        responseTimeSum += diffMs / 1000
        responseTimeCount++
      } else {
        incompleteRecordsCount++
      }
    }

    // 2. Resolution time
    if (isResolved && resolved && !isNaN(resolved.getTime())) {
      const diffMs = resolved.getTime() - detected.getTime()
      if (diffMs >= 0) {
        resolutionTimeSum += diffMs / 1000
        resolutionTimeCount++
      }
    }

    // 3. Assignment time
    if (assigned && !isNaN(assigned.getTime())) {
      const diffMs = assigned.getTime() - detected.getTime()
      if (diffMs >= 0) {
        assignmentTimeSum += diffMs / 1000
        assignmentTimeCount++
      }
    }

    // 4. Actual on-site response time (only if recorded)
    if (responseStarted && !isNaN(responseStarted.getTime())) {
      const diffMs = responseStarted.getTime() - detected.getTime()
      if (diffMs >= 0) {
        onSiteResponseTimeSum += diffMs / 1000
        onSiteResponseTimeCount++
      }
    }

    // 5. SLA Compliance
    const slaTargetMins = SLA_THRESHOLDS_MINUTES[inc.severity]?.acknowledge || 120
    const slaTargetMs = slaTargetMins * 60 * 1000

    if (acknowledged && !isNaN(acknowledged.getTime())) {
      const ackDurationMs = acknowledged.getTime() - detected.getTime()
      if (ackDurationMs >= 0) {
        slaDenominator++
        if (ackDurationMs <= slaTargetMs) {
          slaNumerator++
        }
      }
    } else {
      // Not yet acknowledged: Check if expired
      const elapsedMs = now.getTime() - detected.getTime()
      if (elapsedMs > slaTargetMs) {
        // Expired SLA (breached)
        slaDenominator++
      }
      // If elapsed <= target, still pending within target window, not counted in denominator
    }
  }

  const avgResponseTimeSeconds = responseTimeCount > 0 ? responseTimeSum / responseTimeCount : null
  const avgResolutionTimeSeconds = resolutionTimeCount > 0 ? resolutionTimeSum / resolutionTimeCount : null
  const avgAssignmentTimeSeconds = assignmentTimeCount > 0 ? assignmentTimeSum / assignmentTimeCount : null
  const avgOnSiteResponseTimeSeconds = onSiteResponseTimeCount > 0 ? onSiteResponseTimeSum / onSiteResponseTimeCount : null

  const slaComplianceRate = slaDenominator > 0 ? Math.round((slaNumerator / slaDenominator) * 1000) / 10 : 100
  const totalAssigned = incidents.length
  const resolutionRate = totalAssigned > 0 ? Math.round((resolvedCount / totalAssigned) * 1000) / 10 : 0

  return {
    totalIncidents: incidents.length,
    incidentsAssigned: totalAssigned,
    incidentsResolved: resolvedCount,
    incidentsPending: pendingCount,
    incompleteRecordsCount,

    avgResponseTimeSeconds,
    avgResponseTimeFormatted: formatDuration(avgResponseTimeSeconds),
    responseTimeCount,

    avgResolutionTimeSeconds,
    avgResolutionTimeFormatted: formatDuration(avgResolutionTimeSeconds),
    resolutionTimeCount,

    avgAssignmentTimeSeconds,
    avgAssignmentTimeFormatted: formatDuration(avgAssignmentTimeSeconds),
    assignmentTimeCount,

    hasActualOnSiteResponseData: onSiteResponseTimeCount > 0,
    avgOnSiteResponseTimeSeconds,
    avgOnSiteResponseTimeFormatted: formatDuration(avgOnSiteResponseTimeSeconds),
    onSiteResponseTimeCount,

    slaComplianceRate,
    slaNumerator,
    slaDenominator,

    resolutionRate,
  }
}

/**
 * 1. GET /api/v1/analytics/overview
 */
export async function getAnalyticsOverview(req, res, next) {
  try {
    const user = req.user
    const filterQuery = buildFilterQuery(user, req.query)

    const incidents = await Incident.find(filterQuery)
      .populate('reportedBy', 'name email role department')
      .populate('assignedTo', 'name email role department')
      .lean()

    const metrics = calculateIncidentMetrics(incidents)

    return successResponse(res, {
      message: 'Analytics overview retrieved successfully.',
      data: {
        summary: metrics,
        scope: {
          userRole: user.role,
          userDepartment: user.department,
          isOrganizationWide: user.role === ROLES.ADMIN || user.role === ROLES.HIGHER_AUTHORITY,
        },
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * 2. GET /api/v1/analytics/roles
 * Performance comparison by the 5 role categories
 */
export async function getAnalyticsRoles(req, res, next) {
  try {
    const user = req.user
    const filterQuery = buildFilterQuery(user, req.query)

    const [incidents, allUsers] = await Promise.all([
      Incident.find(filterQuery).lean(),
      User.find().lean(),
    ])

    const usersMap = new Map(allUsers.map((u) => [u._id.toString(), u]))

    const roleDefinitions = [
      { role: ROLES.SECURITY_OFFICER, label: 'Security Officer', department: 'Central Physical Security' },
      { role: ROLES.FACULTY_STAFF, label: 'Faculty / Staff', department: 'Chemistry & Science Labs' },
      { role: ROLES.DEPT_HEAD, label: 'Department Head', department: 'School of Engineering' },
      { role: ROLES.HIGHER_AUTHORITY, label: 'Higher Authority', department: 'Campus Executive Council' },
      { role: ROLES.ADMIN, label: 'Administrator', department: 'Campus Safety Directorate' },
    ]

    // Group incidents by resolved role
    const incidentsByRole = {
      [ROLES.SECURITY_OFFICER]: [],
      [ROLES.FACULTY_STAFF]: [],
      [ROLES.DEPT_HEAD]: [],
      [ROLES.HIGHER_AUTHORITY]: [],
      [ROLES.ADMIN]: [],
    }

    for (const inc of incidents) {
      const assignedRole = resolveIncidentRole(inc, usersMap)
      if (incidentsByRole[assignedRole]) {
        incidentsByRole[assignedRole].push(inc)
      } else {
        incidentsByRole[ROLES.ADMIN].push(inc)
      }
    }

    const rolesData = roleDefinitions.map((def) => {
      const roleIncidents = incidentsByRole[def.role] || []
      const metrics = calculateIncidentMetrics(roleIncidents)

      return {
        role: def.role,
        roleLabel: def.label,
        department: def.department,
        incidentsAssigned: metrics.incidentsAssigned,
        incidentsResolved: metrics.incidentsResolved,
        incidentsPending: metrics.incidentsPending,
        avgResponseTimeSeconds: metrics.avgResponseTimeSeconds,
        avgResponseTimeFormatted: metrics.avgResponseTimeFormatted,
        responseTimeCount: metrics.responseTimeCount,
        avgResolutionTimeSeconds: metrics.avgResolutionTimeSeconds,
        avgResolutionTimeFormatted: metrics.avgResolutionTimeFormatted,
        resolutionTimeCount: metrics.resolutionTimeCount,
        slaComplianceRate: metrics.slaComplianceRate,
        resolutionRate: metrics.resolutionRate,
        hasActualOnSiteResponseData: metrics.hasActualOnSiteResponseData,
        avgOnSiteResponseTimeSeconds: metrics.avgOnSiteResponseTimeSeconds,
      }
    })

    return successResponse(res, {
      message: 'Role performance analytics retrieved.',
      data: {
        roles: rolesData,
        totalIncidents: incidents.length,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * 3. GET /api/v1/analytics/trends
 * Response-time and resolution-time trends over time
 */
export async function getAnalyticsTrends(req, res, next) {
  try {
    const user = req.user
    const filterQuery = buildFilterQuery(user, req.query)

    const incidents = await Incident.find(filterQuery)
      .sort({ detectedAt: 1 })
      .lean()

    const daysRequested = parseInt(req.query.days || req.query.range?.replace('d', '') || '30', 10)
    const activeDays = !isNaN(daysRequested) && daysRequested > 0 ? daysRequested : 30

    // Build day buckets map for the specified range
    const bucketMap = new Map()
    const now = new Date()

    for (let i = activeDays - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const dateKey = d.toISOString().split('T')[0]
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      bucketMap.set(dateKey, {
        date: dateKey,
        label,
        incidents: [],
      })
    }

    // Populate buckets with matching incidents
    for (const inc of incidents) {
      if (!inc.detectedAt) continue
      const dateKey = new Date(inc.detectedAt).toISOString().split('T')[0]
      if (bucketMap.has(dateKey)) {
        bucketMap.get(dateKey).incidents.push(inc)
      }
    }

    // Compute metrics per bucket
    const trendPoints = Array.from(bucketMap.values()).map((bucket) => {
      const metrics = calculateIncidentMetrics(bucket.incidents)
      return {
        date: bucket.date,
        label: bucket.label,
        incidentCount: bucket.incidents.length,
        avgResponseTimeSeconds: metrics.avgResponseTimeSeconds ? Math.round(metrics.avgResponseTimeSeconds) : 0,
        avgResponseTimeMinutes: metrics.avgResponseTimeSeconds ? +(metrics.avgResponseTimeSeconds / 60).toFixed(1) : 0,
        avgResolutionTimeSeconds: metrics.avgResolutionTimeSeconds ? Math.round(metrics.avgResolutionTimeSeconds) : 0,
        avgResolutionTimeMinutes: metrics.avgResolutionTimeSeconds ? +(metrics.avgResolutionTimeSeconds / 60).toFixed(1) : 0,
        resolvedCount: metrics.incidentsResolved,
        slaComplianceRate: metrics.slaComplianceRate,
      }
    })

    return successResponse(res, {
      message: 'Response time trends retrieved.',
      data: {
        timeRangeDays: activeDays,
        trends: trendPoints,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * 4. GET /api/v1/analytics/workload
 * Workload distribution by role category, severity, and hazard category
 */
export async function getAnalyticsWorkload(req, res, next) {
  try {
    const user = req.user
    const filterQuery = buildFilterQuery(user, req.query)

    const [incidents, allUsers] = await Promise.all([
      Incident.find(filterQuery).lean(),
      User.find().lean(),
    ])

    const usersMap = new Map(allUsers.map((u) => [u._id.toString(), u]))

    const roleWorkload = {
      [ROLES.SECURITY_OFFICER]: { role: ROLES.SECURITY_OFFICER, label: 'Security Officer', assigned: 0, resolved: 0, pending: 0 },
      [ROLES.FACULTY_STAFF]: { role: ROLES.FACULTY_STAFF, label: 'Faculty / Staff', assigned: 0, resolved: 0, pending: 0 },
      [ROLES.DEPT_HEAD]: { role: ROLES.DEPT_HEAD, label: 'Department Head', assigned: 0, resolved: 0, pending: 0 },
      [ROLES.HIGHER_AUTHORITY]: { role: ROLES.HIGHER_AUTHORITY, label: 'Higher Authority', assigned: 0, resolved: 0, pending: 0 },
      [ROLES.ADMIN]: { role: ROLES.ADMIN, label: 'Administrator', assigned: 0, resolved: 0, pending: 0 },
    }

    const severityWorkload = {
      Critical: { severity: 'Critical', total: 0, resolved: 0, pending: 0 },
      High: { severity: 'High', total: 0, resolved: 0, pending: 0 },
      Medium: { severity: 'Medium', total: 0, resolved: 0, pending: 0 },
      Low: { severity: 'Low', total: 0, resolved: 0, pending: 0 },
    }

    const categoryWorkload = {}

    for (const inc of incidents) {
      const assignedRole = resolveIncidentRole(inc, usersMap)
      const roleObj = roleWorkload[assignedRole] || roleWorkload[ROLES.ADMIN]
      const isResolved = inc.status === INCIDENT_STATUSES.RESOLVED || inc.status === INCIDENT_STATUSES.CLOSED

      roleObj.assigned++
      if (isResolved) {
        roleObj.resolved++
      } else {
        roleObj.pending++
      }

      if (severityWorkload[inc.severity]) {
        severityWorkload[inc.severity].total++
        if (isResolved) {
          severityWorkload[inc.severity].resolved++
        } else {
          severityWorkload[inc.severity].pending++
        }
      }

      const cat = inc.hazardCategory || 'Other hazards'
      if (!categoryWorkload[cat]) {
        categoryWorkload[cat] = { category: cat, total: 0, resolved: 0, pending: 0 }
      }
      categoryWorkload[cat].total++
      if (isResolved) {
        categoryWorkload[cat].resolved++
      } else {
        categoryWorkload[cat].pending++
      }
    }

    return successResponse(res, {
      message: 'Workload distribution retrieved.',
      data: {
        byRole: Object.values(roleWorkload),
        bySeverity: Object.values(severityWorkload),
        byCategory: Object.values(categoryWorkload),
        totalIncidents: incidents.length,
      },
    })
  } catch (err) {
    next(err)
  }
}

/**
 * 5. GET /api/v1/analytics/leaderboard
 * Transparent individual responder performance ranking
 */
export async function getAnalyticsLeaderboard(req, res, next) {
  try {
    const user = req.user
    const filterQuery = buildFilterQuery(user, req.query)

    const [incidents, allUsers] = await Promise.all([
      Incident.find(filterQuery).lean(),
      User.find({ isActive: true }).lean(),
    ])

    // Build per-person aggregation
    const personMap = new Map()

    for (const u of allUsers) {
      personMap.set(u.name, {
        id: u._id.toString(),
        name: u.name,
        email: u.email,
        role: u.role,
        department: u.department,
        incidents: [],
        lastActiveAt: u.lastLoginAt || u.updatedAt || null,
      })
    }

    // Match each incident to responsible person(s)
    for (const inc of incidents) {
      let matchedPerson = null

      if (inc.assignedOfficer && personMap.has(inc.assignedOfficer)) {
        matchedPerson = personMap.get(inc.assignedOfficer)
      } else if (inc.assignedStaff && personMap.has(inc.assignedStaff)) {
        matchedPerson = personMap.get(inc.assignedStaff)
      } else if (inc.assignedTo) {
        for (const p of personMap.values()) {
          if (p.id === inc.assignedTo.toString()) {
            matchedPerson = p
            break
          }
        }
      }

      if (matchedPerson) {
        matchedPerson.incidents.push(inc)
        const recentTime = inc.resolvedAt || inc.acknowledgedAt || inc.responseStartedAt || inc.assignedAt || inc.updatedAt
        if (recentTime) {
          const recDate = new Date(recentTime)
          if (!matchedPerson.lastActiveAt || recDate > new Date(matchedPerson.lastActiveAt)) {
            matchedPerson.lastActiveAt = recDate
          }
        }
      }
    }

    // Compute metrics for each person
    const leaderboard = Array.from(personMap.values()).map((p) => {
      const metrics = calculateIncidentMetrics(p.incidents)
      const hasSufficientData = p.incidents.length >= 1

      return {
        id: p.id,
        name: p.name,
        email: p.email,
        role: p.role,
        department: p.department,
        incidentsAssigned: p.incidents.length,
        incidentsResolved: metrics.incidentsResolved,
        incidentsPending: metrics.incidentsPending,
        avgResponseTimeSeconds: metrics.avgResponseTimeSeconds,
        avgResponseTimeFormatted: metrics.avgResponseTimeFormatted,
        avgResolutionTimeSeconds: metrics.avgResolutionTimeSeconds,
        avgResolutionTimeFormatted: metrics.avgResolutionTimeFormatted,
        slaComplianceRate: metrics.slaComplianceRate,
        resolutionRate: metrics.resolutionRate,
        lastActiveAt: p.lastActiveAt,
        hasSufficientData,
      }
    })

    // Sort order
    const sortBy = req.query.sortBy || 'resolved'
    const order = req.query.order === 'asc' ? 1 : -1

    leaderboard.sort((a, b) => {
      // Prioritize profiles with sufficient data
      if (a.hasSufficientData && !b.hasSufficientData) return -1
      if (!a.hasSufficientData && b.hasSufficientData) return 1

      if (sortBy === 'responseTime') {
        const valA = a.avgResponseTimeSeconds ?? 999999
        const valB = b.avgResponseTimeSeconds ?? 999999
        return (valA - valB) * (req.query.order === 'desc' ? -1 : 1)
      }
      if (sortBy === 'resolutionTime') {
        const valA = a.avgResolutionTimeSeconds ?? 999999
        const valB = b.avgResolutionTimeSeconds ?? 999999
        return (valA - valB) * (req.query.order === 'desc' ? -1 : 1)
      }
      if (sortBy === 'slaCompliance') {
        return (a.slaComplianceRate - b.slaComplianceRate) * order
      }
      // default: resolved cases
      return (a.incidentsResolved - b.incidentsResolved) * order
    })

    // Add rank index for those with sufficient data
    let currentRank = 1
    const rankedLeaderboard = leaderboard.map((item) => {
      if (item.hasSufficientData) {
        return { ...item, rank: currentRank++ }
      }
      return { ...item, rank: null }
    })

    return successResponse(res, {
      message: 'Leaderboard analytics retrieved.',
      data: {
        leaderboard: rankedLeaderboard,
        totalResponders: rankedLeaderboard.length,
      },
    })
  } catch (err) {
    next(err)
  }
}
