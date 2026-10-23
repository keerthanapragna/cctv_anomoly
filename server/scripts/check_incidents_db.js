import dns from 'dns'
import mongoose from 'mongoose'
import { Incident } from '../models/Incident.js'
import { env } from '../config/env.js'

dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4'])

async function checkIncidents() {
  await mongoose.connect(env.MONGODB_URI)
  const incidents = await Incident.find({
    hazardCategory: { $in: ['Fight detection', 'Violence detection'] }
  }).sort({ createdAt: -1 }).limit(5)

  console.log(`Found ${incidents.length} recent violence incidents in MongoDB:`)
  for (const inc of incidents) {
    console.log(`- ${inc.incidentId}: ${inc.title} | Severity: ${inc.severity} | Score: ${(inc.evidenceMetadata?.violenceScore * 100).toFixed(1)}% | Sensor: ${inc.evidenceMetadata?.sensorId} | CreatedAt: ${inc.createdAt.toISOString()}`)
  }
  await mongoose.disconnect()
}

checkIncidents().catch(console.error)
