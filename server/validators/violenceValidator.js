import { z } from 'zod'

export const analyzeFramesSchema = z.object({
  frames: z
    .array(z.string().min(10, 'Frame base64 string must not be empty'))
    .min(1, 'At least 1 frame is required in the frames array')
    .max(32, 'Maximum of 32 frames per sequence allowed'),
  threshold: z.number().min(0.01).max(0.99).optional().default(0.65),
  cameraId: z.string().trim().optional().default('CAM-WEBCAM'),
  source: z.enum(['webcam', 'cctv', 'recorded_file']).optional().default('webcam'),
})

export const cctvStartSchema = z.object({
  streamUrl: z.string().trim().optional(),
  cameraId: z.string().trim().optional().default('CAM-CCTV-01'),
  sampleInterval: z.number().min(1.0).max(30.0).optional().default(4.0),
  threshold: z.number().min(0.01).max(0.99).optional().default(0.65),
})

export const violenceIngestSchema = z.object({
  category: z.string().optional().default('Fight detection'),
  confidence: z.number().min(0.0).max(1.0),
  cameraId: z.string().min(1, 'cameraId is required'),
  timestamp: z.string().datetime().optional(),
  details: z.string().max(1000).optional(),
  location: z.union([z.string(), z.record(z.any())]).optional(),
  metadata: z.record(z.any()).optional().default({}),
  snapshotUrl: z.string().optional().default(''),
})
