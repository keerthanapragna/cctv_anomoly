import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateIncidentMetrics,
  formatDuration,
  buildAnalyticsScopeQuery,
  buildFilterQuery,
  resolveIncidentRole,
} from '../controllers/analyticsController.js'
import { ROLES, SEVERITIES, INCIDENT_STATUSES } from '../config/constants.js'

describe('Response Performance Analytics Suite', () => {
  describe('1. Duration Formatter Tests', () => {
    it('formats seconds correctly into readable strings', () => {
      assert.equal(formatDuration(null), 'N/A')
      assert.equal(formatDuration(undefined), 'N/A')
      assert.equal(formatDuration(-5), 'N/A')
      assert.equal(formatDuration(0), '0 sec')
      assert.equal(formatDuration(45), '45 sec')
      assert.equal(formatDuration(155), '2 min 35 sec')
      assert.equal(formatDuration(120), '2 min')
      assert.equal(formatDuration(7200), '2.0 hrs')
    })
  })

  describe('2. Metric Calculations & Timestamp Rules', () => {
    it('accurately calculates response time, resolution time, and assignment time', () => {
      const baseTime = new Date('2026-10-21T01:00:00Z')
      const assignedTime = new Date('2026-10-21T01:02:00Z') // +120 sec
      const ackTime = new Date('2026-10-21T01:05:00Z') // +300 sec (5 min)
      const responseTime = new Date('2026-10-21T01:08:00Z') // +480 sec (8 min)
      const resolvedTime = new Date('2026-10-21T01:30:00Z') // +1800 sec (30 min)

      const incidents = [
        {
          incidentId: 'INC-TEST-001',
          severity: SEVERITIES.CRITICAL, // Critical SLA threshold = 15 min
          status: INCIDENT_STATUSES.RESOLVED,
          detectedAt: baseTime,
          assignedAt: assignedTime,
          acknowledgedAt: ackTime,
          responseStartedAt: responseTime,
          resolvedAt: resolvedTime,
        },
      ]

      const metrics = calculateIncidentMetrics(incidents, new Date('2026-10-21T02:00:00Z'))

      assert.equal(metrics.totalIncidents, 1)
      assert.equal(metrics.incidentsAssigned, 1)
      assert.equal(metrics.incidentsResolved, 1)
      assert.equal(metrics.incidentsPending, 0)

      // Response time: 300 seconds
      assert.equal(metrics.avgResponseTimeSeconds, 300)
      assert.equal(metrics.avgResponseTimeFormatted, '5 min')

      // Resolution time: 1800 seconds
      assert.equal(metrics.avgResolutionTimeSeconds, 1800)
      assert.equal(metrics.avgResolutionTimeFormatted, '30 min')

      // Assignment time: 120 seconds
      assert.equal(metrics.avgAssignmentTimeSeconds, 120)
      assert.equal(metrics.avgAssignmentTimeFormatted, '2 min')

      // On-site response time: 480 seconds
      assert.equal(metrics.hasActualOnSiteResponseData, true)
      assert.equal(metrics.avgOnSiteResponseTimeSeconds, 480)
      assert.equal(metrics.avgOnSiteResponseTimeFormatted, '8 min')

      // SLA Compliance: acknowledged in 5 min <= 15 min target -> 100%
      assert.equal(metrics.slaComplianceRate, 100)
      assert.equal(metrics.resolutionRate, 100)
    })

    it('handles pending incidents without treating missing timestamps as zero', () => {
      const baseTime = new Date('2026-10-21T01:00:00Z')
      const incidents = [
        {
          incidentId: 'INC-PENDING-001',
          severity: SEVERITIES.MEDIUM, // SLA = 120 mins
          status: INCIDENT_STATUSES.ASSIGNED,
          detectedAt: baseTime,
          assignedAt: new Date('2026-10-21T01:01:00Z'),
          acknowledgedAt: null, // Still pending acknowledgement
          resolvedAt: null, // Still pending resolution
        },
      ]

      // Current time is 30 mins after detection (within 120m SLA)
      const now = new Date('2026-10-21T01:30:00Z')
      const metrics = calculateIncidentMetrics(incidents, now)

      assert.equal(metrics.incidentsPending, 1)
      assert.equal(metrics.incidentsResolved, 0)
      // Response time cannot be calculated because it is not acknowledged yet; not 0!
      assert.equal(metrics.avgResponseTimeSeconds, null)
      assert.equal(metrics.avgResponseTimeFormatted, 'N/A')
      assert.equal(metrics.avgResolutionTimeSeconds, null)
      assert.equal(metrics.avgResolutionTimeFormatted, 'N/A')
      // Assignment time is valid
      assert.equal(metrics.avgAssignmentTimeSeconds, 60)
      assert.equal(metrics.resolutionRate, 0)
    })

    it('correctly detects expired SLA when unacknowledged incident exceeds threshold', () => {
      const baseTime = new Date('2026-10-21T01:00:00Z')
      const incidents = [
        {
          incidentId: 'INC-EXPIRED-001',
          severity: SEVERITIES.CRITICAL, // Critical threshold = 15 min
          status: INCIDENT_STATUSES.NEW,
          detectedAt: baseTime,
          acknowledgedAt: null,
          resolvedAt: null,
        },
      ]

      // Now is 45 mins after detection -> exceeded 15 mins -> SLA expired / breached
      const now = new Date('2026-10-21T01:45:00Z')
      const metrics = calculateIncidentMetrics(incidents, now)

      assert.equal(metrics.slaDenominator, 1)
      assert.equal(metrics.slaNumerator, 0)
      assert.equal(metrics.slaComplianceRate, 0) // 0% compliance due to expired SLA
    })

    it('gracefully handles empty incident datasets', () => {
      const metrics = calculateIncidentMetrics([])
      assert.equal(metrics.totalIncidents, 0)
      assert.equal(metrics.incidentsAssigned, 0)
      assert.equal(metrics.incidentsResolved, 0)
      assert.equal(metrics.incidentsPending, 0)
      assert.equal(metrics.avgResponseTimeSeconds, null)
      assert.equal(metrics.avgResponseTimeFormatted, 'N/A')
      assert.equal(metrics.avgResolutionTimeSeconds, null)
      assert.equal(metrics.avgResolutionTimeFormatted, 'N/A')
      assert.equal(metrics.slaComplianceRate, 100)
      assert.equal(metrics.resolutionRate, 0)
    })

    it('safely excludes corrupted or inverted timestamps from duration averages', () => {
      const baseTime = new Date('2026-10-21T02:00:00Z')
      const invalidAck = new Date('2026-10-21T01:00:00Z') // Acknowledged BEFORE detection!

      const incidents = [
        {
          incidentId: 'INC-CORRUPT-001',
          severity: SEVERITIES.LOW,
          status: INCIDENT_STATUSES.ASSIGNED,
          detectedAt: baseTime,
          acknowledgedAt: invalidAck,
        },
      ]

      const metrics = calculateIncidentMetrics(incidents)
      assert.equal(metrics.responseTimeCount, 0)
      assert.equal(metrics.avgResponseTimeSeconds, null)
      assert.equal(metrics.incompleteRecordsCount, 1)
    })
  })

  describe('3. Role Scoping & Access Control Rules', () => {
    it('grants Administrator organization-wide scope', () => {
      const admin = { role: ROLES.ADMIN, department: 'Campus Safety Directorate' }
      const scope = buildAnalyticsScopeQuery(admin)
      assert.deepEqual(scope, {})
    })

    it('grants Higher Authority organization-wide scope', () => {
      const executive = { role: ROLES.HIGHER_AUTHORITY, department: 'Campus Executive Council' }
      const scope = buildAnalyticsScopeQuery(executive)
      assert.deepEqual(scope, {})
    })

    it('strictly confines Department Head to their authorized department', () => {
      const deptHead = { role: ROLES.DEPT_HEAD, department: 'School of Engineering' }
      const scope = buildAnalyticsScopeQuery(deptHead)
      assert.deepEqual(scope, { department: 'School of Engineering' })
    })

    it('confines Faculty Staff to their department or assigned incidents', () => {
      const faculty = { _id: 'user123', name: 'Prof. Miller', role: ROLES.FACULTY_STAFF, department: 'Chemistry & Science Labs' }
      const scope = buildAnalyticsScopeQuery(faculty)
      assert.ok(scope.$or)
      assert.equal(scope.$or[0].department, 'Chemistry & Science Labs')
    })

    it('prevents cross-department queries by unauthorized roles via buildFilterQuery', () => {
      const faculty = { _id: 'user123', name: 'Prof. Miller', role: ROLES.FACULTY_STAFF, department: 'Chemistry & Science Labs' }
      // Attempting to filter by unauthorized department
      const filter = buildFilterQuery(faculty, { department: 'School of Engineering' })
      // Scope query must still be enforced
      assert.ok(filter.$and || filter.$or)
    })
  })

  describe('4. Role Attribution Mapping', () => {
    it('correctly attributes incidents to roles based on assignments', () => {
      const usersMap = new Map([
        ['user1', { _id: 'user1', name: 'Officer Davis', role: ROLES.SECURITY_OFFICER }],
        ['user2', { _id: 'user2', name: 'Prof. Miller', role: ROLES.FACULTY_STAFF }],
      ])

      const securityInc = { assignedOfficer: 'Officer Davis' }
      assert.equal(resolveIncidentRole(securityInc, usersMap), ROLES.SECURITY_OFFICER)

      const facultyInc = { assignedStaff: 'Prof. Miller' }
      assert.equal(resolveIncidentRole(facultyInc, usersMap), ROLES.FACULTY_STAFF)

      const escalatedInc = { isEscalated: true, escalationTier: 'Tier 2 (Higher Authority)' }
      assert.equal(resolveIncidentRole(escalatedInc, usersMap), ROLES.HIGHER_AUTHORITY)
    })
  })
})
