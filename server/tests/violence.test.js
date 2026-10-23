import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeFramesSchema,
  cctvStartSchema,
  violenceIngestSchema,
} from '../validators/violenceValidator.js'
import { ROLES, HAZARD_CATEGORIES, SEVERITIES } from '../config/constants.js'

describe('Violence Detection Subsystem & Validation Suite', () => {
  it('validates genuine frame sequence payload', () => {
    const payload = {
      frames: [
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...',
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...',
      ],
      threshold: 0.65,
      cameraId: 'CAM-WEBCAM-01',
      source: 'webcam',
    }
    const result = analyzeFramesSchema.safeParse(payload)
    assert.equal(result.success, true)
    assert.equal(result.data.threshold, 0.65)
    assert.equal(result.data.cameraId, 'CAM-WEBCAM-01')
    assert.equal(result.data.source, 'webcam')
  })

  it('rejects frame sequence with empty frames array', () => {
    const payload = {
      frames: [],
      threshold: 0.65,
    }
    const result = analyzeFramesSchema.safeParse(payload)
    assert.equal(result.success, false)
    assert.ok(result.error.errors.some((e) => e.path.includes('frames')))
  })

  it('rejects frame sequence with invalid threshold (< 0.01 or > 0.99)', () => {
    const payload = {
      frames: ['data:image/jpeg;base64,validbase64string12345'],
      threshold: 1.5,
    }
    const result = analyzeFramesSchema.safeParse(payload)
    assert.equal(result.success, false)
    assert.ok(result.error.errors.some((e) => e.path.includes('threshold')))
  })

  it('validates CCTV start request schema with valid parameters', () => {
    const payload = {
      streamUrl: 'rtsp://user:pass@192.168.1.100:554/live',
      cameraId: 'CAM-PERIMETER-04',
      sampleInterval: 3.5,
      threshold: 0.70,
    }
    const result = cctvStartSchema.safeParse(payload)
    assert.equal(result.success, true)
    assert.equal(result.data.sampleInterval, 3.5)
    assert.equal(result.data.threshold, 0.70)
  })

  it('rejects CCTV start request with sample interval < 1.0 second', () => {
    const payload = {
      sampleInterval: 0.2, // Below 1.0s limit to protect CPU
    }
    const result = cctvStartSchema.safeParse(payload)
    assert.equal(result.success, false)
    assert.ok(result.error.errors.some((e) => e.path.includes('sampleInterval')))
  })

  it('validates CCTV ingest webhook payload from background worker', () => {
    const payload = {
      confidence: 0.88,
      cameraId: 'CAM-CCTV-02',
      details: 'Automated CCTV Alert: Moderate suspected violence on CAM-CCTV-02',
      metadata: {
        source: 'cctv',
        violence_score: 0.88,
        uncertainty: 0.22,
        threshold: 0.65,
      },
    }
    const result = violenceIngestSchema.safeParse(payload)
    assert.equal(result.success, true)
    assert.equal(result.data.confidence, 0.88)
    assert.equal(result.data.cameraId, 'CAM-CCTV-02')
  })

  it('rejects CCTV ingest payload missing cameraId', () => {
    const payload = {
      confidence: 0.88,
    }
    const result = violenceIngestSchema.safeParse(payload)
    assert.equal(result.success, false)
    assert.ok(result.error.errors.some((e) => e.path.includes('cameraId')))
  })

  it('verifies Fight detection and Violence detection categories exist in constants', () => {
    assert.ok(HAZARD_CATEGORIES.includes('Fight detection'))
    assert.ok(HAZARD_CATEGORIES.includes('Violence detection'))
  })
})
