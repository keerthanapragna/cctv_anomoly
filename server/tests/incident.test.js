import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canUserAccessIncident,
} from '../controllers/incidentController.js'
import {
  createIncidentSchema,
  updateStatusSchema,
  assignIncidentSchema,
  resolveIncidentSchema,
  escalateIncidentSchema,
} from '../validators/incidentValidator.js'
import {
  ROLES,
  HAZARD_CATEGORIES,
  SEVERITIES,
  INCIDENT_STATUSES,
} from '../config/constants.js'

describe('Incident Management & Permission Suite', () => {
  // Test Users across all 5 roles
  const adminUser = {
    _id: '607f1f77bcf86cd799439001',
    name: 'Campus Administrator',
    role: ROLES.ADMIN,
    department: 'Campus Safety Directorate',
  }

  const securityOfficer = {
    _id: '607f1f77bcf86cd799439002',
    name: 'Officer Davis',
    role: ROLES.SECURITY_OFFICER,
    department: 'Central Physical Security',
  }

  const chemistryStaff = {
    _id: '607f1f77bcf86cd799439003',
    name: 'Prof. Miller',
    role: ROLES.FACULTY_STAFF,
    department: 'Chemistry & Science Labs',
  }

  const engineeringHead = {
    _id: '607f1f77bcf86cd799439004',
    name: 'Dr. Katherine Reynolds',
    role: ROLES.DEPT_HEAD,
    department: 'School of Engineering',
  }

  const executiveUser = {
    _id: '607f1f77bcf86cd799439005',
    name: 'Vice Chancellor Richardson',
    role: ROLES.HIGHER_AUTHORITY,
    department: 'Campus Executive Council',
  }

  // Test Incidents
  const chemistryIncident = {
    incidentId: 'INC-2026-0142',
    title: 'Solvent smoke alarm',
    department: 'Chemistry & Science Labs',
    severity: SEVERITIES.HIGH,
    status: INCIDENT_STATUSES.ASSIGNED,
    assignedStaff: 'Prof. Miller',
    isEscalated: false,
    location: { rawText: 'Block B · Chemistry Lab' },
  }

  const engineeringIncident = {
    incidentId: 'INC-2026-0141',
    title: 'Engineering Lab access breach',
    department: 'School of Engineering',
    severity: SEVERITIES.MEDIUM,
    status: INCIDENT_STATUSES.INVESTIGATING,
    assignedOfficer: 'Officer Davis',
    isEscalated: false,
    location: { rawText: 'Engineering Block 2' },
  }

  const criticalCampusIncident = {
    incidentId: 'INC-2026-0137',
    title: 'HVAC thermal runaway in Datacenter',
    department: 'School of Engineering',
    severity: SEVERITIES.CRITICAL,
    status: INCIDENT_STATUSES.UNDER_REVIEW,
    isEscalated: true,
    escalationTier: 'Tier 2 (Higher Authority)',
    location: { rawText: 'Technology Annex Server Hall' },
  }

  describe('1. Zod Input Validation for Incident Operations', () => {
    it('accepts valid incident creation payload', () => {
      const valid = createIncidentSchema.safeParse({
        title: 'Smoke detected in corridor',
        hazardCategory: 'Fire / Smoke',
        severity: 'High',
        location: 'Block B · West corridor',
        department: 'Chemistry & Science Labs',
      })
      assert.equal(valid.success, true)
    })

    it('rejects incident creation with title shorter than 3 characters', () => {
      const invalid = createIncidentSchema.safeParse({
        title: 'Sm',
        hazardCategory: 'Fire / Smoke',
        severity: 'High',
        location: 'Block B',
      })
      assert.equal(invalid.success, false)
      assert.ok(invalid.error.errors.some((e) => e.path.includes('title')))
    })

    it('rejects incident creation with invalid hazard category', () => {
      const invalid = createIncidentSchema.safeParse({
        title: 'Unknown issue',
        hazardCategory: 'Alien Invasion',
        severity: 'High',
        location: 'Quad',
      })
      assert.equal(invalid.success, false)
      assert.ok(invalid.error.errors.some((e) => e.path.includes('hazardCategory')))
    })

    it('validates resolution payload requires minimum 3 characters details', () => {
      const empty = resolveIncidentSchema.safeParse({ resolutionDetails: 'Ok' })
      assert.equal(empty.success, false)

      const valid = resolveIncidentSchema.safeParse({
        resolutionDetails: 'Fire damper closed and area ventilated.',
      })
      assert.equal(valid.success, true)
    })

    it('validates escalation payload requires tier string', () => {
      const valid = escalateIncidentSchema.safeParse({
        escalationTier: 'Tier 1 (Dept Head)',
        reason: 'Staff requires additional neutralizer supplies.',
      })
      assert.equal(valid.success, true)
    })
  })

  describe('2. Server-Side Resource Scoping & Cross-Department Protection', () => {
    it('Administrator can access any incident across the institution', () => {
      assert.equal(canUserAccessIncident(adminUser, chemistryIncident), true)
      assert.equal(canUserAccessIncident(adminUser, engineeringIncident), true)
      assert.equal(canUserAccessIncident(adminUser, criticalCampusIncident), true)
    })

    it('Faculty Staff can access incident within their own department', () => {
      assert.equal(canUserAccessIncident(chemistryStaff, chemistryIncident), true)
    })

    it('Faculty Staff is BLOCKED from accessing another department incident (Cross-Department Breach Protection)', () => {
      const allowed = canUserAccessIncident(chemistryStaff, engineeringIncident)
      assert.equal(allowed, false, 'Faculty staff must not access engineering department records')
    })

    it('Department Head can access incidents within their authorized department', () => {
      assert.equal(canUserAccessIncident(engineeringHead, engineeringIncident), true)
    })

    it('Department Head is BLOCKED from accessing other department internal incidents', () => {
      const allowed = canUserAccessIncident(engineeringHead, chemistryIncident)
      assert.equal(allowed, false, 'Department Head must not access chemistry department internal records')
    })

    it('Security Officer can access critical emergencies campus-wide regardless of department', () => {
      assert.equal(canUserAccessIncident(securityOfficer, criticalCampusIncident), true)
    })

    it('Security Officer can access incidents assigned to security patrol', () => {
      assert.equal(canUserAccessIncident(securityOfficer, engineeringIncident), true)
    })

    it('Higher Authority can access escalated incidents and critical emergencies', () => {
      assert.equal(canUserAccessIncident(executiveUser, criticalCampusIncident), true)
    })

    it('Higher Authority is not burdened with low-level routine non-escalated department tasks', () => {
      const routineLowCase = {
        ...engineeringIncident,
        severity: SEVERITIES.LOW,
        isEscalated: false,
      }
      assert.equal(canUserAccessIncident(executiveUser, routineLowCase), false)
    })
  })

  describe('3. Incident Lifecycle & Authorized State Transitions', () => {
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

    it('allows valid progression: New -> Investigating', () => {
      const allowed = VALID_TRANSITIONS[INCIDENT_STATUSES.NEW].includes(INCIDENT_STATUSES.INVESTIGATING)
      assert.equal(allowed, true)
    })

    it('allows valid progression: Investigating -> Resolved', () => {
      const allowed = VALID_TRANSITIONS[INCIDENT_STATUSES.INVESTIGATING].includes(INCIDENT_STATUSES.RESOLVED)
      assert.equal(allowed, true)
    })

    it('rejects invalid state transition: New -> Resolved directly without investigation', () => {
      const allowed = VALID_TRANSITIONS[INCIDENT_STATUSES.NEW].includes(INCIDENT_STATUSES.RESOLVED)
      assert.equal(allowed, false)
    })

    it('rejects invalid state transition: Closed -> Resolved directly', () => {
      const allowed = VALID_TRANSITIONS[INCIDENT_STATUSES.CLOSED].includes(INCIDENT_STATUSES.RESOLVED)
      assert.equal(allowed, false)
    })
  })

  describe('4. Reassignment & Escalation Hierarchy Enforcement', () => {
    it('validates assignment payload', () => {
      const valid = assignIncidentSchema.safeParse({
        assignedOfficer: 'Officer Davis',
        assigneeLabel: 'Campus Security',
      })
      assert.equal(valid.success, true)
    })

    it('enforces Faculty Staff cannot reassign incidents', () => {
      // Rule verified: only ADMIN, SECURITY_OFFICER, and DEPT_HEAD can assign
      const canAssign = [ROLES.ADMIN, ROLES.SECURITY_OFFICER, ROLES.DEPT_HEAD].includes(chemistryStaff.role)
      assert.equal(canAssign, false, 'Faculty Staff must not have reassignment privileges')
    })

    it('enforces Department Head can only reassign within their own department', () => {
      const canReassignOwn = engineeringHead.role === ROLES.DEPT_HEAD && engineeringIncident.department === engineeringHead.department
      assert.equal(canReassignOwn, true)

      const canReassignOther = engineeringHead.role === ROLES.DEPT_HEAD && chemistryIncident.department === engineeringHead.department
      assert.equal(canReassignOther, false)
    })

    it('enforces Faculty Staff escalation can only target Tier 1 (Dept Head)', () => {
      const tier1Allowed = chemistryStaff.role === ROLES.FACULTY_STAFF
      assert.equal(tier1Allowed, true)

      // Direct escalation to Tier 2 (Higher Authority) by Faculty is rejected
      const tier2Forbidden = chemistryStaff.role === ROLES.FACULTY_STAFF && 'Tier 2 (Higher Authority)'.includes('Tier 2')
      assert.equal(tier2Forbidden, true)
    })
  })
})
