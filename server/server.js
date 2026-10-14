import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import morgan from 'morgan'
import mongoose from 'mongoose'
import { env } from './config/env.js'
import { connectDB, disconnectDB } from './config/db.js'
import { successResponse } from './utils/apiResponse.js'
import { notFoundHandler, errorHandler } from './middleware/errorMiddleware.js'
import authRoutes from './routes/authRoutes.js'
import userRoutes from './routes/userRoutes.js'
import incidentRoutes from './routes/incidentRoutes.js'
import sensorRoutes from './routes/sensorRoutes.js'
import directiveRoutes from './routes/directiveRoutes.js'

const app = express()

// Security and utility middleware
app.use(helmet())
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl) or localhost / 127.0.0.1 dev ports
      if (!origin || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true)
      }
      if (origin === env.CLIENT_URL) {
        return callback(null, true)
      }
      return callback(new Error(`CORS origin not allowed: ${origin}`))
    },
    credentials: true,
  }),
)
app.use(cookieParser())
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'))
}

// Health Check Endpoint (supports both /api/health and /api/v1/health)
const healthHandler = (req, res) => {
  const dbStatus =
    mongoose.connection.readyState === 1
      ? 'connected'
      : mongoose.connection.readyState === 2
        ? 'connecting'
        : 'disconnected'

  return successResponse(res, {
    message: 'Hazard Response API is operational',
    data: {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      database: dbStatus,
    },
  })
}

app.get('/api/health', healthHandler)
app.get('/api/v1/health', healthHandler)

// Routes
app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/users', userRoutes)
app.use('/api/v1/incidents', incidentRoutes)
app.use('/api/v1/sensors', sensorRoutes)
app.use('/api/v1/directives', directiveRoutes)

// Central 404 & Error Handling
app.use(notFoundHandler)
app.use(errorHandler)

// Server initialization
const PORT = env.PORT

let server = null

async function startServer() {
  try {
    console.log('[Init] Connecting to MongoDB...')
    await connectDB()
  } catch (dbErr) {
    console.warn(`[Init] Proceeding with server start (MongoDB connection pending: ${dbErr.message})`)
  }

  server = app.listen(PORT, () => {
    console.log(`[Server] Hazard Response API running on http://localhost:${PORT} (${env.NODE_ENV})`)
    console.log(`[Server] Health check: http://localhost:${PORT}/api/health`)
  })
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`)
  if (server) {
    server.close(() => {
      console.log('[Server] HTTP server closed.')
    })
  }
  await disconnectDB()
  process.exit(0)
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

if (process.env.NODE_ENV !== 'test') {
  startServer()
}

export default app
