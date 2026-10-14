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

const SAMPLE_INCIDENTS = [
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
    assignedOfficer: 'Officer Davis',
    assignedStaff: 'Prof. Miller',
    deadline: '15 mins (Urgent)',
    isOverdue: false,
    isEscalated: true,
    escalationTier: 'Tier 2 (Higher Authority)',
    evidenceMetadata: {
      sensorId: 'SMOKE-B2-04',
      sensorStatus: 'Alarm active',
      snapshotUrl: '',
      tamperFlags: [],
    },
    notes: '[Sample Data] Automated fire dampers engaged. Lab evacuated.',
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
    assignedOfficer: 'Officer Davis',
    assignedStaff: null,
    deadline: '90 mins',
    isOverdue: false,
    isEscalated: false,
    escalationTier: null,
    evidenceMetadata: {
      sensorId: 'CAM-12',
      sensorStatus: 'Tampered / Degraded signal',
      snapshotUrl: '',
      tamperFlags: ['spray_paint_detected'],
    },
    notes: '[Sample Data] Physical lens inspection underway by unit.',
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
    assigneeLabel: 'Dr. Katherine Reynolds',
    assignedOfficer: null,
    assignedStaff: 'Dr. Katherine Reynolds',
    deadline: 'Met',
    isOverdue: false,
    isEscalated: false,
    escalationTier: null,
    evidenceMetadata: {
      sensorId: 'RFID-DOOR-ENG2',
      sensorStatus: 'Normal',
      snapshotUrl: '',
      tamperFlags: [],
    },
    notes: '[Sample Data] Access verified for authorized research fellow.',
    resolutionDetails: 'Verified security logs with faculty coordinator.',
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
    assigneeLabel: 'Prof. Miller',
    assignedOfficer: 'Officer Davis',
    assignedStaff: 'Prof. Miller',
    deadline: 'Overdue by 25 mins',
    isOverdue: true,
    isEscalated: true,
    escalationTier: 'Tier 1 (Dept Head)',
    evidenceMetadata: {
      sensorId: 'VAPOR-DETECTOR-CHEM3',
      sensorStatus: 'Threshold Warning',
      snapshotUrl: '',
      tamperFlags: [],
    },
    notes: '[Sample Data] Awaiting specialized neutralizer kit confirmation.',
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
    assignedOfficer: 'Officer Davis',
    assignedStaff: null,
    deadline: 'Immediate (Directive Required)',
    isOverdue: true,
    isEscalated: true,
    escalationTier: 'Tier 2 (Higher Authority)',
    evidenceMetadata: {
      sensorId: 'THERMAL-SENSOR-DC1',
      sensorStatus: 'Critical 41°C',
      snapshotUrl: '',
      tamperFlags: [],
    },
    notes: '[Sample Data] Primary chiller failed; secondary cooling initiated.',
  },
]

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

    // 3. Seed Sample Incidents (check each incidentId)
    console.log('[Seed] Checking sample incidents...')
    let addedIncidents = 0
    const adminUser = userMap[ROLES.ADMIN]
    for (const incData of SAMPLE_INCIDENTS) {
      const existing = await Incident.findOne({ incidentId: incData.incidentId })
      if (!existing) {
        await Incident.create({
          ...incData,
          reportedBy: adminUser._id,
        })
        addedIncidents++
        console.log(`       + Inserted sample incident: ${incData.incidentId} - ${incData.title}`)
      } else {
        console.log(`       = Existing incident preserved: ${incData.incidentId}`)
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
