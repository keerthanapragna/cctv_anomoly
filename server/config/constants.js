export const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  SECURITY_OFFICER: 'SECURITY_OFFICER',
  FACULTY_STAFF: 'FACULTY_STAFF',
  DEPT_HEAD: 'DEPT_HEAD',
  HIGHER_AUTHORITY: 'HIGHER_AUTHORITY',
})

export const HAZARD_CATEGORIES = Object.freeze([
  'Fire / Smoke',
  'Human safety',
  'Fall detection',
  'Dog attack detection',
  'Fight detection',
  'Violence detection',
  'Camera tampering',
  'Unauthorized access',
  'Environmental hazard',
  'Other hazards',
])

export const SEVERITIES = Object.freeze({
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
})

export const INCIDENT_STATUSES = Object.freeze({
  NEW: 'New',
  ASSIGNED: 'Assigned',
  INVESTIGATING: 'Investigating',
  UNDER_REVIEW: 'Under review',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
})

export const INCIDENT_SOURCES = Object.freeze({
  MANUAL: 'MANUAL',
  AI_CAMERA: 'AI_CAMERA',
  AI_GENERATED: 'AI_GENERATED',
  IOT_SENSOR: 'IOT_SENSOR',
  SIMULATED: 'SIMULATED',
})

export const AUDIT_ACTIONS = Object.freeze({
  INCIDENT_CREATED: 'INCIDENT_CREATED',
  ASSIGNED: 'ASSIGNED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  ESCALATED: 'ESCALATED',
  NOTE_ADDED: 'NOTE_ADDED',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
})

// Default SLA thresholds in minutes by severity
export const SLA_THRESHOLDS_MINUTES = Object.freeze({
  [SEVERITIES.CRITICAL]: { acknowledge: 15, resolve: 120 },
  [SEVERITIES.HIGH]: { acknowledge: 30, resolve: 240 },
  [SEVERITIES.MEDIUM]: { acknowledge: 120, resolve: 720 },
  [SEVERITIES.LOW]: { acknowledge: 360, resolve: 1440 },
})
