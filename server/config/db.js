import mongoose from 'mongoose'
import { env } from './env.js'

export async function connectDB() {
  try {
    mongoose.connection.on('connected', () => {
      console.log(`[DB] Connected to MongoDB host: ${mongoose.connection.host}`)
    })

    mongoose.connection.on('error', (err) => {
      console.error('[DB] MongoDB connection error:', err)
    })

    mongoose.connection.on('disconnected', () => {
      console.warn('[DB] MongoDB disconnected')
    })

    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    })

    return mongoose.connection
  } catch (error) {
    console.error(`[DB] Failed to connect to MongoDB: ${error.message}`)
    // Re-throw so caller can decide whether to continue in dev or exit
    throw error
  }
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
    console.log('[DB] Disconnected from MongoDB')
  }
}
