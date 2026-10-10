import { z } from 'zod'
import { ROLES } from '../config/constants.js'

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Invalid email address'),
  password: z
    .string()
    .min(1, 'Password is required'),
})

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name cannot exceed 100 characters'),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  role: z.enum(Object.values(ROLES), {
    errorMap: () => ({ message: `Role must be one of: ${Object.values(ROLES).join(', ')}` }),
  }),
  department: z
    .string()
    .trim()
    .min(2, 'Department is required')
    .max(100, 'Department cannot exceed 100 characters'),
  phone: z.string().trim().optional(),
})

export const bootstrapAdminSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters'),
  email: z
    .string()
    .trim()
    .email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  department: z
    .string()
    .trim()
    .default('Campus Safety Administration'),
  phone: z.string().trim().optional(),
})
