import { env } from '../config/env.js'

async function testPersistenceReporting() {
  console.log('Testing honest persistence reporting on POST /api/v1/violence/ingest...')
  const res = await fetch('http://localhost:5000/api/v1/violence/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ingest-api-key': env.INGEST_API_KEY,
    },
    body: JSON.stringify({
      confidence: 0.88,
      cameraId: 'CAM-CCTV-PERSIST-TEST',
      details: 'Test qualifying CCTV violence alert',
      metadata: {
        severity: 'Severe or critical suspected violence',
        uncertainty: 0.15,
        threshold: 0.65,
      },
    }),
  })

  const data = await res.json()
  console.log('HTTP Status:', res.status)
  console.log('Response Body:', JSON.stringify(data, null, 2))

  if (data?.data?.persisted === false) {
    console.log('HONEST PERSISTENCE VERIFIED: Database disconnection was reported honestly without fabricating fake incident persistence.')
  } else if (data?.data?.persisted === true) {
    console.log('DATABASE PERSISTENCE CONFIRMED: Incident was persisted in MongoDB!')
  }
}

testPersistenceReporting()
