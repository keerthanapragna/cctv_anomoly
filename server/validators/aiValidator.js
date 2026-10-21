import { z } from 'zod'

export const aiDetectionSchema = z.object({
  category: z.string().trim().min(2, 'Hazard category or event type is required'),
  confidence: z.number().min(0).max(1).optional().default(0.85),
  cameraId: z.string().trim().min(1, 'Camera or Sensor ID is required'),
  timestamp: z.string().optional(),
  details: z.string().trim().optional(),
  location: z
    .union([
      z.string(),
      z.object({
        building: z.string().optional(),
        floor: z.string().optional(),
        zone: z.string().optional(),
        rawText: z.string().optional(),
      }),
    ])
    .optional(),
  metadata: z
    .object({
      trackId: z.union([z.number(), z.string()]).optional(),
      secondaryTrackId: z.union([z.number(), z.string()]).optional(),
      boundingBox: z.array(z.number()).optional(),
      keypointsAvailable: z.boolean().optional(),
      cues: z.record(z.any()).optional(),
    })
    .optional(),
  snapshotUrl: z.string().optional(),
})

export const testInferenceSchema = z.object({
  image: z.string().min(1, 'Image data (base64 or data URL) is required'),
  cameraId: z.string().trim().optional(),
  sourceId: z.string().trim().optional(),
})

export const triggerScenarioSchema = z.object({
  scenario: z.union([z.number(), z.string()]).transform((val) => Number(val)),
  cameraId: z.string().trim().optional().default('CAM-12'),
})
