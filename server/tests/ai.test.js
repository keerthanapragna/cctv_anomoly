import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  aiDetectionSchema,
  testInferenceSchema,
  triggerScenarioSchema,
} from '../validators/aiValidator.js'
import { HAZARD_CATEGORIES } from '../config/constants.js'

describe('AI Hazard Ingestion & Validation Suite', () => {
  it('validates genuine fall detection payload', () => {
    const payload = {
      category: 'POSSIBLE_FALL',
      confidence: 0.92,
      cameraId: 'CAM-12',
      timestamp: new Date().toISOString(),
      details: 'Track #1: Sudden descent, horizontal posture, ground rest 1.5s',
      metadata: {
        trackId: 1,
        keypointsAvailable: true,
      },
    }
    const result = aiDetectionSchema.safeParse(payload)
    assert.equal(result.success, true)
    assert.equal(result.data.category, 'POSSIBLE_FALL')
    assert.equal(result.data.cameraId, 'CAM-12')
    assert.equal(result.data.confidence, 0.92)
  })

  it('validates genuine dog attack detection payload', () => {
    const payload = {
      category: 'POSSIBLE_DOG_ATTACK',
      confidence: 0.88,
      cameraId: 'CAM-ENG-08',
      details: 'Person #1 / Dog #1: close overlap for 2.0s with movement burst',
      metadata: {
        trackId: 1,
        secondaryTrackId: 1,
      },
    }
    const result = aiDetectionSchema.safeParse(payload)
    assert.equal(result.success, true)
    assert.equal(result.data.confidence, 0.88)
  })

  it('validates genuine altercation detection payload', () => {
    const payload = {
      category: 'POSSIBLE_ALTERCATION',
      confidence: 0.81,
      cameraId: 'CAM-QUAD-02',
      details: 'Track #1 & #2: sustained physical struggle (1.2s, conf=0.81)',
      metadata: {
        trackId: 1,
        secondaryTrackId: 2,
      },
    }
    const result = aiDetectionSchema.safeParse(payload)
    assert.equal(result.success, true)
  })

  it('rejects payload missing cameraId', () => {
    const payload = {
      category: 'POSSIBLE_FALL',
      confidence: 0.9,
    }
    const result = aiDetectionSchema.safeParse(payload)
    assert.equal(result.success, false)
    assert.ok(result.error.errors.some((e) => e.path.includes('cameraId')))
  })

  it('rejects payload with invalid confidence range (> 1.0)', () => {
    const payload = {
      category: 'POSSIBLE_FALL',
      cameraId: 'CAM-01',
      confidence: 1.5,
    }
    const result = aiDetectionSchema.safeParse(payload)
    assert.equal(result.success, false)
    assert.ok(result.error.errors.some((e) => e.path.includes('confidence')))
  })

  it('validates testInferenceSchema with image base64 data', () => {
    const valid = testInferenceSchema.safeParse({
      image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
      cameraId: 'CAM-01',
    })
    assert.equal(valid.success, true)
    assert.equal(valid.data.cameraId, 'CAM-01')

    const invalid = testInferenceSchema.safeParse({})
    assert.equal(invalid.success, false)
  })

  it('validates triggerScenarioSchema with scenario number', () => {
    const valid = triggerScenarioSchema.safeParse({
      scenario: '6',
      cameraId: 'CAM-12',
    })
    assert.equal(valid.success, true)
    assert.equal(valid.data.scenario, 6)
    assert.equal(valid.data.cameraId, 'CAM-12')
  })

  it('verifies HAZARD_CATEGORIES includes all required model categories', () => {
    assert.ok(HAZARD_CATEGORIES.includes('Fall detection'), 'Must include Fall detection')
    assert.ok(HAZARD_CATEGORIES.includes('Dog attack detection'), 'Must include Dog attack detection')
    assert.ok(HAZARD_CATEGORIES.includes('Fight detection'), 'Must include Fight detection')
  })
})
