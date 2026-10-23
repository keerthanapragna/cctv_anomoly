import {
  LayoutDashboard,
  ClipboardList,
  Camera,
  ShieldAlert,
  Users,
  FileText,
  Radio,
  Clock3,
  Building2,
  ScrollText,
  BarChart2,
} from 'lucide-react'

export const ROLE_CONFIGS = {
  ADMIN: {
    role: 'ADMIN',
    roleLabel: 'Administrator',
    title: 'Campus Safety Governance & Operations',
    subtitle: 'System-wide monitoring, user management, sensor infrastructure, and institutional reports.',
    badgeText: 'Full System Authorization',
    badgeColor: 'bg-[#f4e6eb] text-[#8c2f50]',
    scopeDescription: 'Campus-wide (All academic blocks, parking structures, and facilities)',
    navItems: [
      { id: 'Overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'All Incidents', label: 'All Incidents', icon: ClipboardList, badgeKey: 'total' },
      { id: 'Violence AI & Live Camera', label: 'Live Camera & Violence AI', icon: Camera },
      { id: 'Cameras & Sensors', label: 'Cameras & Sensors', icon: Camera },
      { id: 'Escalations', label: 'Escalations & SLAs', icon: ShieldAlert, badgeKey: 'escalated' },
      { id: 'People & Roles', label: 'People & Roles', icon: Users },
      { id: 'Reports', label: 'Audit & Reports', icon: FileText },
      { id: 'Response Performance', label: 'Response Performance', icon: BarChart2 },
    ],
    capabilities: {
      canCreateIncident: true,
      canAssignPersonnel: true,
      canAcknowledge: true,
      canUpdateStatus: true,
      canEscalate: true,
      canManageUsers: true,
      canViewAllSensors: true,
      canIssueDirective: false,
    },
    filterIncidents: (incidents) => incidents,
  },

  SECURITY_OFFICER: {
    role: 'SECURITY_OFFICER',
    roleLabel: 'Security Officer',
    title: 'Central Dispatch & Field Security Operations',
    subtitle: 'Incoming hazard alarms, field unit assignments, camera obstruction alerts, and rapid patrol dispatches.',
    badgeText: 'Security Field Dispatch',
    badgeColor: 'bg-blue-50 text-blue-700',
    scopeDescription: 'Central Security Division & Active Field Incidents',
    navItems: [
      { id: 'Overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'Field Dispatch', label: 'Field Dispatch', icon: Radio, badgeKey: 'open' },
      { id: 'Assigned Patrols', label: 'My Patrol Tasks', icon: ClipboardList, badgeKey: 'assigned' },
      { id: 'Violence AI & Live Camera', label: 'Live Camera & Violence AI', icon: Camera },
      { id: 'Camera Tampering', label: 'Cameras & Tampering', icon: Camera, badgeKey: 'tampered' },
      { id: 'Action History', label: 'Dispatch Log', icon: FileText },
    ],
    capabilities: {
      canCreateIncident: true,
      canAssignPersonnel: true,
      canAcknowledge: true,
      canUpdateStatus: true,
      canEscalate: true,
      canManageUsers: false,
      canViewAllSensors: true,
      canIssueDirective: false,
    },
    filterIncidents: (incidents, user) =>
      incidents.filter(
        (i) =>
          i.assignee === 'Campus Security' ||
          i.assignedOfficer === user.name ||
          i.department === 'Central Physical Security' ||
          i.severity === 'Critical',
      ),
  },

  FACULTY_STAFF: {
    role: 'FACULTY_STAFF',
    roleLabel: 'Faculty / Assigned Staff',
    title: 'Faculty Safety & Department Tasks',
    subtitle: 'Assigned laboratory and building safety tasks, response deadlines, and department hazard notifications.',
    badgeText: 'Department Assigned Staff',
    badgeColor: 'bg-emerald-50 text-emerald-700',
    scopeDescription: 'Assigned Department: Chemistry & Science Labs',
    navItems: [
      { id: 'Overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'My Action Items', label: 'My Action Items', icon: ClipboardList, badgeKey: 'assigned' },
      { id: 'Department Safety', label: 'Chemistry Lab Safety', icon: Building2, badgeKey: 'open' },
      { id: 'Escalation Requests', label: 'Escalation Requests', icon: ShieldAlert, badgeKey: 'escalated' },
    ],
    capabilities: {
      canCreateIncident: true, // Can file hazards within own department
      canAssignPersonnel: false,
      canAcknowledge: true,
      canUpdateStatus: true,
      canEscalate: true, // Can request escalation to Dept Head
      canManageUsers: false,
      canViewAllSensors: false,
      canIssueDirective: false,
    },
    filterIncidents: (incidents, user) =>
      incidents.filter(
        (i) =>
          i.assignedStaff === user.name ||
          i.department === user.department,
      ),
  },

  DEPT_HEAD: {
    role: 'DEPT_HEAD',
    roleLabel: 'Department Head',
    title: 'School of Engineering Safety Oversight',
    subtitle: 'Department-level hazard oversight, staff response tracking, overdue task interventions, and resolution sign-offs.',
    badgeText: 'Department Head Authority',
    badgeColor: 'bg-purple-50 text-purple-700',
    scopeDescription: 'Department Scope: School of Engineering (All Labs & Blocks)',
    navItems: [
      { id: 'Overview', label: 'Overview', icon: LayoutDashboard },
      { id: 'Department Incidents', label: 'Engineering Incidents', icon: Building2, badgeKey: 'total' },
      { id: 'Pending Escalations', label: 'Pending Escalations', icon: ShieldAlert, badgeKey: 'escalated' },
      { id: 'Staff Workload', label: 'Coordinator Workload', icon: Users },
      { id: 'Safety Compliance', label: 'Department Compliance', icon: FileText },
    ],
    capabilities: {
      canCreateIncident: true,
      canAssignPersonnel: true, // Can reassign within department
      canAcknowledge: true,
      canUpdateStatus: true,
      canEscalate: true, // Can escalate to Higher Authority
      canManageUsers: false,
      canViewAllSensors: false,
      canIssueDirective: false,
    },
    filterIncidents: (incidents, user) =>
      incidents.filter(
        (i) =>
          i.department === user.department ||
          (i.severity === 'Critical' && i.location.includes('Engineering')),
      ),
  },

  HIGHER_AUTHORITY: {
    role: 'HIGHER_AUTHORITY',
    roleLabel: 'Higher Authority',
    title: 'Executive Safety Council & Institutional Accountability',
    subtitle: 'High-level incident oversight, Tier 2 escalations, critical emergency governance, and executive directives.',
    badgeText: 'Campus Executive Authority',
    badgeColor: 'bg-amber-50 text-amber-700',
    scopeDescription: 'Institution-Wide Escalations & Critical Incident Governance',
    navItems: [
      { id: 'Overview', label: 'Executive Briefing', icon: LayoutDashboard },
      { id: 'Escalation Board', label: 'Tier 2 Escalations', icon: ShieldAlert, badgeKey: 'escalated' },
      { id: 'Critical Hazards', label: 'Critical Emergencies', icon: Clock3, badgeKey: 'critical' },
      { id: 'Institutional Audit', label: 'SLA Audit & Accountability', icon: ScrollText },
      { id: 'Executive Directives', label: 'Executive Directives', icon: FileText },
      { id: 'Response Performance', label: 'Response Performance', icon: BarChart2 },
    ],
    capabilities: {
      canCreateIncident: false, // Routine reporting handled by staff/security
      canAssignPersonnel: false,
      canAcknowledge: true,
      canUpdateStatus: false,
      canEscalate: false,
      canManageUsers: false,
      canViewAllSensors: false,
      canIssueDirective: true, // Exclusive authority to issue directives
    },
    filterIncidents: (incidents) =>
      incidents.filter((i) => i.isEscalated === true || i.severity === 'Critical'),
  },
}
