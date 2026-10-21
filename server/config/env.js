import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })
dotenv.config()


const envSchema = z.object({
  PORT: z
    .string()
    .default('5000')
    .transform((val) => parseInt(val, 10)),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  MONGODB_URI: z
    .string()
    .min(1, { message: 'MONGODB_URI is required' }),
  JWT_SECRET: z
    .string()
    .min(16, { message: 'JWT_SECRET must be at least 16 characters' }),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_SECRET: z
    .string()
    .min(16, { message: 'REFRESH_TOKEN_SECRET must be at least 16 characters' }),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  INGEST_API_KEY: z.string().min(8, { message: 'INGEST_API_KEY must be at least 8 characters' }),
  INFERENCE_SERVICE_URL: z.string().default('http://127.0.0.1:8000'),
})

const parsedEnv = envSchema.safeParse(process.env)

if (!parsedEnv.success) {
  console.error('Environment validation error:', parsedEnv.error.format())
  process.exit(1)
}

export const env = parsedEnv.data
