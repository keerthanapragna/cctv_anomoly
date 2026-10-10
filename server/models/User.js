import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { ROLES } from '../config/constants.js'

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address',
      ],
      index: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: Object.values(ROLES),
        message: 'Invalid user role: {VALUE}',
      },
      default: ROLES.FACULTY_STAFF,
      index: true,
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true,
      maxlength: [100, 'Department cannot exceed 100 characters'],
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    refreshTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash
        delete ret.refreshTokenHash
        delete ret.__v
        return ret
      },
    },
  },
)

// Compare candidate password with stored hash
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.passwordHash) {
    throw new Error('passwordHash is not selected on user document')
  }
  return bcrypt.compare(candidatePassword, this.passwordHash)
}

// Compare candidate refresh token with stored refresh token hash
userSchema.methods.compareRefreshToken = async function (candidateToken) {
  if (!this.refreshTokenHash) return false
  return bcrypt.compare(candidateToken, this.refreshTokenHash)
}

// Static helper to hash password
userSchema.statics.hashPassword = async function (plainPassword) {
  const salt = await bcrypt.genSalt(12)
  return bcrypt.hash(plainPassword, salt)
}

// Static helper to hash refresh token
userSchema.statics.hashRefreshToken = async function (token) {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(token, salt)
}

export const User = mongoose.model('User', userSchema)
