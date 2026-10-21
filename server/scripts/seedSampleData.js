import { connectDB, disconnectDB } from '../config/db.js'
import { User } from '../models/User.js'
import { Incident } from '../models/Incident.js'
import { Sensor } from '../models/Sensor.js'
import { Directive } from '../models/Directive.js'
import { ROLES, HAZARD_CATEGORIES, SEVERITIES, INCIDENT_STATUSES } from '../config/constants.js'

const SAMPLE_USERS = [
  {
    role: ROLES.ADMIN,
    email: 'admin@campus.safety',
    password: 'AdminPassword123!',
    name: 'Campus Administrator',
    department: 'Campus Safety Directorate',
  },
  {
    role: ROLES.SECURITY_OFFICER,
    email: 'security@campus.safety',
    password: 'OfficerPassword123!',
    name: 'Officer Davis',
    department: 'Central Physical Security',
  },
  {
    role: ROLES.FACULTY_STAFF,
    email: 'faculty@campus.safety',
    password: 'FacultyPassword123!',
    name: 'Prof. Miller',
    department: 'Chemistry & Science Labs',
  },
  {
    role: ROLES.DEPT_HEAD,
    email: 'depthead@campus.safety',
    password: 'DeptHeadPassword123!',
    name: 'Dr. Katherine Reynolds',
    department: 'School of Engineering',
  },
  {
    role: ROLES.HIGHER_AUTHORITY,
    email: 'executive@campus.safety',
    password: 'AuthorityPassword123!',
    name: 'Vice Chancellor Richardson',
    department: 'Campus Executive Council',
  },
]

const SAMPLE_SENSORS = [
  {
    sensorId: 'CAM-12',
    name: 'South Parking Structure · CAM-12',
    type: 'PTZ Optical Camera',
    location: 'Parking Area Ground',
    status: 'Tampered',
    health: '42%',
    issue: 'Lens spray / partial view obscuration',
    lastPing: '10:31 AM',
    severity: 'Medium',
    isSample: true,
  },
  {
    sensorId: 'SMOKE-B2-04',
    name: 'Chemistry Lab Room 104 Detector',
    type: 'Optical Smoke / Ionization Sensor',
    location: 'Block B · Chemistry Lab',
    status: 'Alarm Active',
    health: '98%',
    issue: 'Particulate density over threshold (380 ppm)',
    lastPing: '10:42 AM',
    severity: 'Critical',
    isSample: true,
  },
  {
    sensorId: 'CAM-ENG-08',
    name: 'Engineering Quad Cam 8',
    type: '4K Panoramic CCTV',
    location: 'Engineering Block 2 Quad',
    status: 'Live Feed',
    health: '99%',
    issue: 'None · Anomaly flagged in perimeter',
    lastPing: '10:44 AM',
    severity: 'High',
    isSample: true,
  },
  {
    sensorId: 'THERMAL-SENSOR-DC1',
    name: 'Datacenter Hall A Temperature Node',
    type: 'Environmental Thermal Probe',
    location: 'Technology Annex Server Hall',
    status: 'Thermal Warning',
    health: '91%',
    issue: 'Temperature 41.2°C (Warning > 35°C)',
    lastPing: '10:40 AM',
    severity: 'Critical',
    isSample: true,
  },
  {
    sensorId: 'RFID-DOOR-ENG2',
    name: 'Room 210 Smart Access Lock',
    type: 'Access Control Gateway',
    location: 'Engineering Lab Floor 2',
    status: 'Normal',
    health: '100%',
    issue: 'None · Standard operations',
    lastPing: '10:44 AM',
    severity: 'Low',
    isSample: true,
  },
]

function makeDates(hoursAgo, ackDelayMins, responseDelayMins, resolveDelayMins) {
  const detectedAt = new Date(Date.now() - hoursAgo * 3600 * 1000)
  const assignedAt = new Date(detectedAt.getTime() + 60 * 1000) // 1 min after detection
  const acknowledgedAt = ackDelayMins !== null ? new Date(detectedAt.getTime() + ackDelayMins * 60 * 1000) : null
  const responseStartedAt = responseDelayMins !== null ? new Date(detectedAt.getTime() + responseDelayMins * 60 * 1000) : null
  const resolvedAt = resolveDelayMins !== null ? new Date(detectedAt.getTime() + resolveDelayMins * 60 * 1000) : null

  return { detectedAt, assignedAt, acknowledgedAt, responseStartedAt, resolvedAt }
}

async function buildSampleIncidents(userMap) {
  const admin = userMap[ROLES.ADMIN]
  const officer = userMap[ROLES.SECURITY_OFFICER]
  const faculty = userMap[ROLES.FACULTY_STAFF]
  const deptHead = userMap[ROLES.DEPT_HEAD]
  const authority = userMap[ROLES.HIGHER_AUTHORITY]

  // Time milestones
  const t1 = makeDates(2, 4, 8, null) // Under review
  const t2 = makeDates(5, 7, 12, null) // Investigating
  const t3 = makeDates(24, 6, 14, 45) // Resolved
  const t4 = makeDates(30, null, null, null) // Assigned, unacknowledged
  const t5 = makeDates(48, 10, 20, null) // Escalated
  const t6 = makeDates(72, 3, 6, 22) // Fall detection (Resolved)
  const t7 = makeDates(96, 5, 9, 35) // Dog attack detection (Resolved)
  const t8 = makeDates(120, 4, 8, 28) // Fight detection (Resolved)
  const t9 = makeDates(140, 8, 15, 60) // Dept head robotics (Resolved)
  const t10 = makeDates(168, 12, 25, 90) // Faculty fume hood (Resolved)

  return [
    {
      incidentId: 'INC-2026-0142',
      title: 'Critical solvent smoke alarm',
      hazardCategory: 'Fire / Smoke',
      location: {
        building: 'Block B',
        floor: 'Floor 1',
        zone: 'Chemistry Lab Room 104',
        rawText: 'Block B · Chemistry Lab Room 104',
      },
      department: 'Chemistry & Science Labs',
      severity: 'Critical',
      status: 'Under review',
      assigneeLabel: 'Campus Security',
      assignedTo: officer._id,
      assignedOfficer: officer.name,
      assignedStaff: faculty.name,
      deadline: '15 mins (Urgent)',
      isOverdue: false,
      isEscalated: true,
      escalationTier: 'Tier 2 (Higher Authority)',
      ...t1,
      evidenceMetadata: {
        sensorId: 'SMOKE-B2-04',
        sensorStatus: 'Alarm active',
        snapshotUrl: '',
        tamperFlags: [],
      },
      notes: '[Sample Data] Automated fire dampers engaged. Lab evacuated.',
      assignmentHistory: [
        {
          assignedTo: officer._id,
          assignedOfficer: officer.name,
          assigneeLabel: 'Campus Security',
          department: 'Chemistry & Science Labs',
          assignedAt: t1.assignedAt,
          assignedBy: admin._id,
          note: 'Assigned to Central Security Division',
        },
      ],
    },
    {
      incidentId: 'INC-2026-0140',
      title: 'Camera obstruction & spray obscuration',
      hazardCategory: 'Camera tampering',
      location: {
        building: 'South Parking Structure',
        floor: 'Ground',
        zone: 'Zone C',
        rawText: 'South Parking Structure · CAM-12',
      },
      department: 'Central Physical Security',
      severity: 'Medium',
      status: 'Investigating',
      assigneeLabel: 'Campus Security',
      assignedTo: officer._id,
      assignedOfficer: officer.name,
      assignedStaff: null,
      deadline: '90 mins',
      isOverdue: false,
      isEscalated: false,
      escalationTier: null,
      ...t2,
      evidenceMetadata: {
        sensorId: 'CAM-12',
        sensorStatus: 'Tampered / Degraded signal',
        snapshotUrl: '',
        tamperFlags: ['spray_paint_detected'],
      },
      notes: '[Sample Data] Physical lens inspection underway by unit.',
      assignmentHistory: [
        {
          assignedTo: officer._id,
          assignedOfficer: officer.name,
          assigneeLabel: 'Campus Security',
          department: 'Central Physical Security',
          assignedAt: t2.assignedAt,
          assignedBy: admin._id,
          note: 'Assigned to Officer Davis',
        },
      ],
    },
    {
      incidentId: 'INC-2026-0139',
      title: 'Unauthorized server laboratory access',
      hazardCategory: 'Unauthorized access',
      location: {
        building: 'Engineering Lab',
        floor: 'Floor 2',
        zone: 'Room 210',
        rawText: 'Engineering Lab · Floor 2 · Room 210',
      },
      department: 'School of Engineering',
      severity: 'Medium',
      status: 'Resolved',
      assigneeLabel: deptHead.name,
      assignedTo: deptHead._id,
      assignedOfficer: null,
      assignedStaff: deptHead.name,
      deadline: 'Met',
      isOverdue: false,
      isEscalated: false,
      escalationTier: null,
      ...t3,
      resolvedBy: deptHead._id,
      evidenceMetadata: {
        sensorId: 'RFID-DOOR-ENG2',
        sensorStatus: 'Normal',
        snapshotUrl: '',
        tamperFlags: [],
      },
      notes: '[Sample Data] Access verified for authorized research fellow.',
      resolutionDetails: 'Verified security logs with faculty coordinator.',
      assignmentHistory: [
        {
          assignedTo: deptHead._id,
          assignedStaff: deptHead.name,
          assigneeLabel: deptHead.name,
          department: 'School of Engineering',
          assignedAt: t3.assignedAt,
          assignedBy: admin._id,
          note: 'Assigned to Dept Head Dr. Reynolds',
        },
      ],
    },
    {
      incidentId: 'INC-2026-0138',
      title: 'Chemical solvent container breach',
      hazardCategory: 'Environmental hazard',
      location: {
        building: 'Chemistry Building',
        floor: 'Basement',
        zone: 'Solvent Depository',
        rawText: 'Chemistry Building · Solvent Depository',
      },
      department: 'Chemistry & Science Labs',
      severity: 'High',
      status: 'Assigned',
      assigneeLabel: faculty.name,
      assignedTo: faculty._id,
      assignedOfficer: officer.name,
      assignedStaff: faculty.name,
      deadline: 'Overdue by 25 mins',
      isOverdue: true,
      isEscalated: true,
      escalationTier: 'Tier 1 (Dept Head)',
      ...t4,
      evidenceMetadata: {
        sensorId: 'VAPOR-DETECTOR-CHEM3',
        sensorStatus: 'Threshold Warning',
        snapshotUrl: '',
        tamperFlags: [],
      },
      notes: '[Sample Data] Awaiting specialized neutralizer kit confirmation.',
      assignmentHistory: [
        {
          assignedTo: faculty._id,
          assignedStaff: faculty.name,
          assigneeLabel: faculty.name,
          department: 'Chemistry & Science Labs',
          assignedAt: t4.assignedAt,
          assignedBy: admin._id,
          note: 'Assigned to Prof. Miller',
        },
      ],
    },
    {
      incidentId: 'INC-2026-0137',
      title: 'HVAC thermal runaway in Main Datacenter',
      hazardCategory: 'Environmental hazard',
      location: {
        building: 'Technology Annex',
        floor: 'Floor 1',
        zone: 'Server Hall A',
        rawText: 'Technology Annex · Server Hall A',
      },
      department: 'School of Engineering',
      severity: 'Critical',
      status: 'Under review',
      assigneeLabel: 'Campus Security',
      assignedTo: officer._id,
      assignedOfficer: officer.name,
      assignedStaff: null,
      deadline: 'Immediate (Directive Required)',
      isOverdue: true,
      isEscalated: true,
      escalationTier: 'Tier 2 (Higher Authority)',
      ...t5,
      evidenceMetadata: {
        sensorId: 'THERMAL-SENSOR-DC1',
        sensorStatus: 'Critical 41°C',
        snapshotUrl: '',
        tamperFlags: [],
      },
      notes: '[Sample Data] Primary chiller failed; secondary cooling initiated.',
      assignmentHistory: [
        {
          assignedTo: officer._id,
          assignedOfficer: officer.name,
          assigneeLabel: 'Campus Security',
          department: 'Central Physical Security',
          assignedAt: t5.assignedAt,
          assignedBy: admin._id,
          note: 'Assigned to Officer Davis',
        },
      ],
    },
    {
      incidentId: 'INC-2026-0145',
      title: 'Slip and fall detected at Central Plaza',
      hazardCategory: 'Fall detection',
      location: {
        building: 'Central Plaza',
        floor: 'Ground',
        zone: 'Plaza Fountain East',
        rawText: 'Central Plaza · Fountain Area',
      },
      department: 'Central Physical Security',
      severity: 'Critical',
      status: 'Resolved',
      assigneeLabel: 'Campus Security',
      assignedTo: officer._id,
      assignedOfficer: officer.name,
      assignedStaff: null,
      deadline: 'Met',
      isOverdue: false,
      isEscalated: false,
      ...t6,
      resolvedBy: officer._id,
      resolutionDetails: 'First aid unit dispatched. Subject assisted safely with zero complications.',
      evidenceMetadata: {
        sensorId: 'CAM-PLAZA-01',
        sensorStatus: 'Normal',
        snapshotUrl: '',
        tamperFlags: [],
      },
      notes: '[AI Perception Alarm] Computer vision posture keypoint anomaly confirmed.',
      assignmentHistory: [
        {
          assignedTo: officer._id,
          assignedOfficer: officer.name,
          assigneeLabel: 'Campus Security',
          department: 'Central Physical Security',
          assignedAt: t6.assignedAt,
          assignedBy: admin._id,
          note: 'Auto-assigned by AI Hazard Perception pipeline',
        },
      ],
    },
    {
      incidentId: 'INC-2026-0146',
      title: 'Aggressive stray dog detected near West Dormitory',
      hazardCategory: 'Dog attack detection',
      location: {
        building: 'West Dormitory Perimeter',
        floor: 'Ground',
        zone: 'Perimeter Gate 4',
        rawText: 'West Dormitory · Gate 4 Path',
      },
      department: 'Central Physical Security',
      severity: 'High',
      status: 'Resolved',
      assigneeLabel: 'Campus Security',
      assignedTo: officer._id,
      assignedOfficer: officer.name,
      assignedStaff: null,
      deadline: 'Met',
      isOverdue: false,
      isEscalated: false,
      ...t7,
      resolvedBy: officer._id,
      resolutionDetails: 'Animal control escorted stray animal outside campus grounds.',
      evidenceMetadata: {
        sensorId: 'CAM-WEST-03',
        sensorStatus: 'Normal',
        snapshotUrl: '',
        tamperFlags: [],
      },
      notes: '[AI Perception Alarm] YOLO detection: canine proximity alert.',
      assignmentHistory: [
        {
          assignedTo: officer._id,
          assignedOfficer: officer.name,
          assigneeLabel: 'Campus Security',
          department: 'Central Physical Security',
          assignedAt: t7.assignedAt,
          assignedBy: admin._id,
          note: 'Assigned to Officer Davis',
        },
      ],
    },
    {
      incidentId: 'INC-2026-0147',
      title: 'Physical altercation in Student Amphitheater',
      hazardCategory: 'Fight detection',
      location: {
        building: 'Student Amphitheater',
        floor: 'Ground',
        zone: 'Tier 1 Seating',
        rawText: 'Amphitheater · Tier 1',
      },
      department: 'Central Physical Security',
      severity: 'High',
      status: 'Resolved',
      assigneeLabel: 'Campus Security',
      assignedTo: officer._id,
      assignedOfficer: officer.name,
      assignedStaff: null,
      deadline: 'Met',
      isOverdue: false,
      isEscalated: false,
      ...t8,
      resolvedBy: officer._id,
      resolutionDetails: 'Campus security officers de-escalated verbal confrontation. Dispersed safely.',
      evidenceMetadata: {
        sensorId: 'CAM-AMPHI-02',
        sensorStatus: 'Normal',
        snapshotUrl: '',
        tamperFlags: [],
      },
      notes: '[AI Perception Alarm] Violent motion optical flow anomaly detected.',
      assignmentHistory: [
        {
          assignedTo: officer._id,
          assignedOfficer: officer.name,
          assigneeLabel: 'Campus Security',
          department: 'Central Physical Security',
          assignedAt: t8.assignedAt,
          assignedBy: admin._id,
          note: 'Field patrol dispatched immediately',
        },
      ],
    },
    {
      incidentId: 'INC-2026-0148',
      title: 'Robotics research lab thermal surge',
      hazardCategory: 'Environmental hazard',
      location: {
        building: 'School of Engineering',
        floor: 'Floor 3',
        zone: 'Autonomous Robotics Lab',
        rawText: 'Engineering Block · Room 302',
      },
      department: 'School of Engineering',
      severity: 'Medium',
      status: 'Resolved',
      assigneeLabel: deptHead.name,
      assignedTo: deptHead._id,
      assignedOfficer: null,
      assignedStaff: deptHead.name,
      deadline: 'Met',
      isOverdue: false,
      isEscalated: false,
      ...t9,
      resolvedBy: deptHead._id,
      resolutionDetails: 'Lithium battery charger disconnected and cooled. Thermal threshold normalized.',
      evidenceMetadata: {
        sensorId: 'THERMAL-ROBOT-01',
        sensorStatus: 'Normal',
        snapshotUrl: '',
        tamperFlags: [],
      },
      notes: '[Lab Telemetry Alert] Thermal surge sensor logged 46°C spike.',
      assignmentHistory: [
        {
          assignedTo: deptHead._id,
          assignedStaff: deptHead.name,
          assigneeLabel: deptHead.name,
          department: 'School of Engineering',
          assignedAt: t9.assignedAt,
          assignedBy: admin._id,
          note: 'Assigned to Dr. Reynolds',
        },
      ],
    },
    {
      incidentId: 'INC-2026-0149',
      title: 'Organic Chemistry Fume Hood Exhaust Drop',
      hazardCategory: 'Environmental hazard',
      location: {
        building: 'Block B',
        floor: 'Floor 2',
        zone: 'Organic Chemistry Lab 208',
        rawText: 'Block B · Organic Chemistry Lab 208',
      },
      department: 'Chemistry & Science Labs',
      severity: 'High',
      status: 'Resolved',
      assigneeLabel: faculty.name,
      assignedTo: faculty._id,
      assignedOfficer: null,
      assignedStaff: faculty.name,
      deadline: 'Met',
      isOverdue: false,
      isEscalated: false,
      ...t10,
      resolvedBy: faculty._id,
      resolutionDetails: 'Exhaust fan belt replaced by facilities maintenance. Flow rates verified.',
      evidenceMetadata: {
        sensorId: 'HOOD-FLOW-08',
        sensorStatus: 'Normal',
        snapshotUrl: '',
        tamperFlags: [],
      },
      notes: '[Safety Monitor Alert] Air velocity dropped below 80 FPM benchmark.',
      assignmentHistory: [
        {
          assignedTo: faculty._id,
          assignedStaff: faculty.name,
          assigneeLabel: faculty.name,
          department: 'Chemistry & Science Labs',
          assignedAt: t10.assignedAt,
          assignedBy: admin._id,
          note: 'Assigned to Prof. Miller',
        },
      ],
    },
  ]
}

async function seedSampleData() {
  try {
    console.log('[Seed] Connecting to MongoDB Atlas...')
    await connectDB()

    // 1. Seed Users (if not existing)
    const userMap = {}
    console.log('[Seed] Checking role accounts...')
    for (const sampleUser of SAMPLE_USERS) {
      let user = await User.findOne({ email: sampleUser.email.toLowerCase() })
      if (!user) {
        const passwordHash = await User.hashPassword(sampleUser.password)
        user = await User.create({
          name: sampleUser.name,
          email: sampleUser.email.toLowerCase(),
          passwordHash,
          role: sampleUser.role,
          department: sampleUser.department,
          isActive: true,
        })
        console.log(`       + Created user: ${sampleUser.email} (${sampleUser.role})`)
      } else {
        console.log(`       = Existing user found: ${sampleUser.email} (${sampleUser.role})`)
      }
      userMap[sampleUser.role] = user
    }

    // 2. Seed Sensors (if none exist)
    const sensorCount = await Sensor.countDocuments()
    if (sensorCount === 0) {
      console.log('[Seed] Inserting sample sensor and camera devices...')
      await Sensor.insertMany(SAMPLE_SENSORS)
      console.log(`       + Inserted ${SAMPLE_SENSORS.length} sample sensors.`)
    } else {
      console.log(`       = ${sensorCount} sensors already exist in database. Preserved without modification.`)
    }

    // 3. Seed Sample Incidents with accurate lifecycle timestamps
    console.log('[Seed] Checking sample incidents with lifecycle timestamps...')
    const sampleIncidents = await buildSampleIncidents(userMap)
    const adminUser = userMap[ROLES.ADMIN]

    for (const incData of sampleIncidents) {
      const existing = await Incident.findOne({ incidentId: incData.incidentId })
      if (!existing) {
        await Incident.create({
          ...incData,
          reportedBy: adminUser._id,
        })
        console.log(`       + Inserted sample incident: ${incData.incidentId} - ${incData.title}`)
      } else {
        // Enrich existing incident with lifecycle timestamps if missing
        let modified = false
        if (!existing.detectedAt && incData.detectedAt) {
          existing.detectedAt = incData.detectedAt
          modified = true
        }
        if (!existing.assignedAt && incData.assignedAt) {
          existing.assignedAt = incData.assignedAt
          modified = true
        }
        if (!existing.acknowledgedAt && incData.acknowledgedAt) {
          existing.acknowledgedAt = incData.acknowledgedAt
          modified = true
        }
        if (!existing.responseStartedAt && incData.responseStartedAt) {
          existing.responseStartedAt = incData.responseStartedAt
          modified = true
        }
        if (!existing.resolvedAt && incData.resolvedAt) {
          existing.resolvedAt = incData.resolvedAt
          modified = true
        }
        if (!existing.assignedTo && incData.assignedTo) {
          existing.assignedTo = incData.assignedTo
          modified = true
        }
        if ((!existing.assignmentHistory || existing.assignmentHistory.length === 0) && incData.assignmentHistory) {
          existing.assignmentHistory = incData.assignmentHistory
          modified = true
        }
        if (modified) {
          await existing.save()
          console.log(`       * Enriched lifecycle timestamps on: ${incData.incidentId}`)
        } else {
          console.log(`       = Existing incident preserved: ${incData.incidentId}`)
        }
      }
    }

    // 4. Seed Directives (if none exist)
    const directiveCount = await Directive.countDocuments()
    if (directiveCount === 0) {
      const executiveUser = userMap[ROLES.HIGHER_AUTHORITY] || adminUser
      console.log('[Seed] Inserting sample executive directive...')
      await Directive.create({
        incidentId: 'INC-2026-0137',
        directiveType: 'Emergency Chiller Protocol',
        instructions:
          'Primary Datacenter HVAC chiller failed. Authorized facilities to engage secondary chiller.',
        issuedAt: '09:30 AM',
        issuedBy: executiveUser._id,
        issuer: executiveUser.name,
        isSample: true,
      })
      console.log('       + Sample executive directive inserted.')
    } else {
      console.log(`       = ${directiveCount} directives already exist in database. Preserved.`)
    }

    console.log('[Seed] Sample data seeding process completed safely.')
    await disconnectDB()
    process.exit(0)
  } catch (error) {
    console.error('[Seed] Error seeding sample data:', error.message)
    await disconnectDB()
    process.exit(1)
  }
}

seedSampleData()
