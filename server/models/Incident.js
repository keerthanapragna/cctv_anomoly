import mongoose from 'mongoose'
import {
  HAZARD_CATEGORIES,
  SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_SOURCES,
} from '../config/constants.js'

const incidentSchema = new mongoose.Schema(
  {
    incidentId: {
      type: String,
      required: [true, 'Incident ID is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      minlength: [3, 'Title must be at least 3 characters'],
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    hazardCategory: {
      type: String,
      enum: {
        values: HAZARD_CATEGORIES,
        message: 'Invalid hazard category: {VALUE}',
      },
      required: [true, 'Hazard category is required'],
      index: true,
    },
    severity: {
      type: String,
      enum: {
        values: Object.values(SEVERITIES),
        message: 'Invalid severity: {VALUE}',
      },
      required: [true, 'Severity is required'],
      index: true,
    },
    location: {
      building: {
        type: String,
        required: [true, 'Building is required'],
        trim: true,
      },
      floor: {
        type: String,
        trim: true,
        default: '',
      },
      zone: {
        type: String,
        trim: true,
        default: '',
      },
      rawText: {
        type: String,
        required: [true, 'Location text is required'],
        trim: true,
      },
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: Object.values(INCIDENT_STATUSES),
        message: 'Invalid incident status: {VALUE}',
      },
      default: INCIDENT_STATUSES.NEW,
      index: true,
    },
    source: {
      type: String,
      enum: {
        values: Object.values(INCIDENT_SOURCES),
        message: 'Invalid source classification: {VALUE}',
      },
      default: INCIDENT_SOURCES.MANUAL,
      index: true,
    },
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Reporting user is required'],
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    assignedOfficer: {
      type: String,
      trim: true,
      default: null,
    },
    assignedStaff: {
      type: String,
      trim: true,
      default: null,
    },
    assigneeLabel: {
      type: String,
      trim: true,
      default: 'Unassigned',
    },
    detectedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    assignedAt: {
      type: Date,
      default: null,
      index: true,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
      index: true,
    },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    responseStartedAt: {
      type: Date,
      default: null,
      index: true,
    },
    responseStartedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
      index: true,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    assignmentHistory: [
      {
        assignedTo: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          default: null,
        },
        assignedOfficer: { type: String, default: null },
        assignedStaff: { type: String, default: null },
        assigneeLabel: { type: String, default: null },
        department: { type: String, default: null },
        assignedAt: { type: Date, default: Date.now },
        assignedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          default: null,
        },
        note: { type: String, default: '' },
      },
    ],
    resolutionDetails: {
      type: String,
      trim: true,
      default: null,
    },
    evidenceMetadata: {
      sensorId: { type: String, default: '' },
      sensorStatus: { type: String, default: '' },
      snapshotUrl: { type: String, default: '' },
      tamperFlags: [{ type: String }],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    isEscalated: {
      type: Boolean,
      default: false,
      index: true,
    },
    escalationTier: {
      type: String,
      default: null,
    },
    escalatedAt: {
      type: Date,
      default: null,
    },
    escalatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    deadline: {
      type: String,
      default: '2 hours',
    },
    isOverdue: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret.incidentId
        delete ret.__v
        return ret
      },
    },
  },
)

// Index for multi-field queries and text search
incidentSchema.index({
  title: 'text',
  description: 'text',
  'location.rawText': 'text',
  department: 'text',
})

incidentSchema.index({ detectedAt: -1, status: 1 })
incidentSchema.index({ department: 1, detectedAt: -1 })
incidentSchema.index({ assignedTo: 1, status: 1 })
incidentSchema.index({ hazardCategory: 1, severity: 1 })

export const Incident = mongoose.model('Incident', incidentSchema)
