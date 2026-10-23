import mongoose from 'mongoose'
import { env } from '../config/env.js'
import { connectDB, disconnectDB } from '../config/db.js'

async function check() {
  console.log('[Check] Checking MongoDB connection string configuration...')
  const rawUri = env.MONGODB_URI
  if (!rawUri) {
    console.error('[Check] ERROR: MONGODB_URI is not set in environment.')
    process.exit(1)
  }

  // Mask credentials for safe logging
  let maskedUri = rawUri
  try {
    const atIdx = rawUri.lastIndexOf('@')
    if (atIdx !== -1) {
      const protoEnd = rawUri.indexOf('://') + 3
      maskedUri = `${rawUri.slice(0, protoEnd)}***:***@${rawUri.slice(atIdx + 1)}`
    }
  } catch {}

  console.log(`[Check] Attempting connection to: ${maskedUri}`)
  try {
    await connectDB()
    console.log('[Check] SUCCESS: Successfully connected to MongoDB!')
    console.log(`[Check] Connection host: ${mongoose.connection.host}`)
    console.log(`[Check] Connection readyState: ${mongoose.connection.readyState}`)
    await disconnectDB()
    process.exit(0)
  } catch (err) {
    console.error(`[Check] CONNECTION FAILED: ${err.message}`)
    if (err.name === 'MongoServerError' && err.code === 8000) {
      console.error('[Check] Diagnosis: Authentication failed (bad credentials or user not authorized on database).')
    } else if (err.message.includes('SSL') || err.message.includes('tlsv1')) {
      console.error('[Check] Diagnosis: SSL/TLS handshake failed or IP not whitelisted in Atlas.')
    } else if (err.name === 'MongooseServerSelectionError') {
      console.error('[Check] Diagnosis: Server selection timeout (cluster unreachable or DNS/network blocker).')
    }
    process.exit(1)
  }
}

check()
