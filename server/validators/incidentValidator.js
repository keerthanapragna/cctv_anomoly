import { z } from 'zod'
import {
  HAZARD_CATEGORIES,
  SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_SOURCES,
} from '../config/constants.js'

export const createIncidentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'Title must be at least 3 characters')
    .max(200, 'Title cannot exceed 200 characters'),
  description: z.string().trim().max(2000).optional(),
  hazardCategory: z.enum(HAZARD_CATEGORIES, {
    errorMap: () => ({ message: `Invalid hazard category. Must be one of: ${HAZARD_CATEGORIES.join(', ')}` }),
  }),
  severity: z.enum(Object.values(SEVERITIES), {
    errorMap: () => ({ message: `Severity must be one of: ${Object.values(SEVERITIES).join(', ')}` }),
  }),
  location: z.union([
    z.string().trim().min(2, 'Location is required'),
    z.object({
      rawText: z.string().trim().min(2),
      building: z.string().trim().optional(),
      floor: z.string().trim().optional(),
      zone: z.string().trim().optional(),
    }),
  ]),
  department: z.string().trim().min(2).optional(),
  source: z.enum(Object.values(INCIDENT_SOURCES)).optional(),
  sensor: z.string().trim().optional(),
  notes: z.string().trim().optional(),
})

export const updateStatusSchema = z.object({
  status: z.enum(Object.values(INCIDENT_STATUSES), {
    errorMap: () => ({ message: `Status must be one of: ${Object.values(INCIDENT_STATUSES).join(', ')}` }),
  }),
  notes: z.string().trim().optional(),
})

export const assignIncidentSchema = z.object({
  assignedTo: z.string().optional(),
  assignedOfficer: z.string().trim().optional(),
  assignedStaff: z.string().trim().optional(),
  assigneeLabel: z.string().trim().optional(),
  department: z.string().trim().optional(),
})

export const resolveIncidentSchema = z.object({
  resolutionDetails: z
    .string()
    .trim()
    .min(3, 'Resolution details must be at least 3 characters'),
})

export const escalateIncidentSchema = z.object({
  escalationTier: z.string().trim().min(2, 'Escalation tier is required'),
  reason: z.string().trim().optional(),
})
