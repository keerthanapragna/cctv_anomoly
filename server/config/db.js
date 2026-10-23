import dns from 'dns'
import mongoose from 'mongoose'
import { env } from './env.js'

export async function connectDB() {
  try {
    let uri = env.MONGODB_URI

    // Automatically resolve SRV records via public DNS if on Windows/local networks where router DNS fails
    if (uri.startsWith('mongodb+srv://')) {
      try {
        dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4'])
      } catch {
        // Fallback to OS default DNS if setServers fails
      }

      // Handle unencoded '@' character in password (e.g. username:pass@word@cluster)
      const srvPrefix = 'mongodb+srv://'
      const rest = uri.slice(srvPrefix.length)
      const lastAt = rest.lastIndexOf('@')
      if (lastAt !== -1) {
        const userInfo = rest.slice(0, lastAt)
        const hostAndParams = rest.slice(lastAt + 1)
        const colonIdx = userInfo.indexOf(':')
        if (colonIdx !== -1) {
          const user = userInfo.slice(0, colonIdx)
          const pass = userInfo.slice(colonIdx + 1)
          // If password contains unencoded '@', encode it to %40
          if (pass.includes('@')) {
            const encodedPass = pass.replace(/@/g, '%40')
            uri = `${srvPrefix}${user}:${encodedPass}@${hostAndParams}`
          }
        }
      }
    }

    mongoose.connection.on('connected', () => {
      console.log(`[DB] Connected to MongoDB host: ${mongoose.connection.host}`)
    })

    mongoose.connection.on('error', (err) => {
      console.error('[DB] MongoDB connection error:', err.message)
    })

    mongoose.connection.on('disconnected', () => {
      console.warn('[DB] MongoDB disconnected')
    })

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    })

    return mongoose.connection
  } catch (error) {
    if (error.message.includes('SSL alert number 80') || error.message.includes('tlsv1 alert internal error')) {
      console.error('[DB] ==============================================================')
      console.error('[DB] MongoDB Atlas SSL Handshake Rejected (SSL alert number 80)')
      console.error('[DB] Reason: Your IP address is not whitelisted in MongoDB Atlas.')
      console.error('[DB] Fix: In MongoDB Atlas -> Network Access -> Add IP Address')
      console.error('[DB]       Add your current public IP, or add 0.0.0.0/0 for development.')
      console.error('[DB] ==============================================================')
    } else {
      console.error(`[DB] Failed to connect to MongoDB: ${error.message}`)
    }
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
