import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  getRefreshCookieOptions,
} from '../utils/tokenUtils.js'
import {
  loginSchema,
  registerSchema,
  bootstrapAdminSchema,
} from '../validators/authValidator.js'
import { authenticateToken, requireRoles } from '../middleware/authMiddleware.js'
import { ROLES } from '../config/constants.js'

describe('Authentication & Role-Based Access Control Suite', () => {
  describe('1. Password Hashing & Bcrypt Verification', () => {
    it('hashes passwords securely with salt and verifies correct matches', async () => {
      const plainPassword = 'StrongPassword123!'
      const salt = await bcrypt.genSalt(12)
      const hash = await bcrypt.hash(plainPassword, salt)

      assert.notEqual(plainPassword, hash)
      assert.ok(hash.startsWith('$2'))

      const isMatch = await bcrypt.compare(plainPassword, hash)
      assert.equal(isMatch, true)

      const isWrongMatch = await bcrypt.compare('WrongPassword456!', hash)
      assert.equal(isWrongMatch, false)
    })
  })

  describe('2. JWT Access and Refresh Token Lifecycle', () => {
    const mockUser = {
      _id: '507f1f77bcf86cd799439011',
      role: ROLES.SECURITY_OFFICER,
      email: 'officer@campus.safety',
      department: 'Campus Security',
    }

    it('generates a valid short-lived access token with correct claims', () => {
      const token = generateAccessToken(mockUser)
      assert.ok(typeof token === 'string' && token.length > 20)

      const decoded = verifyAccessToken(token)
      assert.equal(decoded.userId, mockUser._id)
      assert.equal(decoded.role, ROLES.SECURITY_OFFICER)
      assert.equal(decoded.email, mockUser.email)
      assert.equal(decoded.department, mockUser.department)
      assert.ok(decoded.exp)
    })

    it('generates a valid long-lived refresh token', () => {
      const refreshToken = generateRefreshToken(mockUser)
      assert.ok(typeof refreshToken === 'string')

      const decoded = verifyRefreshToken(refreshToken)
      assert.equal(decoded.userId, mockUser._id)
      assert.equal(decoded.role, ROLES.SECURITY_OFFICER)
    })

    it('rejects tampered or forged tokens', () => {
      const token = generateAccessToken(mockUser)
      const tamperedToken = token.slice(0, -6) + 'abcdef'

      assert.throws(() => verifyAccessToken(tamperedToken))
    })

    it('enforces secure httpOnly cookie policy for refresh tokens', () => {
      const cookieOptions = getRefreshCookieOptions()
      assert.equal(cookieOptions.httpOnly, true)
      assert.equal(cookieOptions.sameSite, 'strict')
      assert.equal(cookieOptions.path, '/api/v1/auth')
      assert.equal(cookieOptions.maxAge, 7 * 24 * 60 * 60 * 1000)
    })
  })

  describe('3. Request Validation Schemas (Zod)', () => {
    it('accepts valid login payloads', () => {
      const result = loginSchema.safeParse({
        email: 'officer@campus.safety',
        password: 'ValidPassword123!',
      })
      assert.equal(result.success, true)
    })

    it('rejects malformed email in login payload', () => {
      const result = loginSchema.safeParse({
        email: 'invalid-email-format',
        password: 'ValidPassword123!',
      })
      assert.equal(result.success, false)
      assert.ok(result.error.errors.some((e) => e.path.includes('email')))
    })

    it('rejects registration with invalid role', () => {
      const result = registerSchema.safeParse({
        name: 'John Doe',
        email: 'john@campus.safety',
        password: 'SecurePassword1!',
        role: 'SUPER_USER_UNKNOWN',
        department: 'IT',
      })
      assert.equal(result.success, false)
      assert.ok(result.error.errors.some((e) => e.path.includes('role')))
    })

    it('rejects registration with weak password (missing number)', () => {
      const result = registerSchema.safeParse({
        name: 'Jane Doe',
        email: 'jane@campus.safety',
        password: 'NoNumbersInThisPassword',
        role: ROLES.FACULTY_STAFF,
        department: 'Science',
      })
      assert.equal(result.success, false)
      assert.ok(result.error.errors.some((e) => e.path.includes('password')))
    })

    it('validates bootstrap admin schema fields', () => {
      const valid = bootstrapAdminSchema.safeParse({
        name: 'Administrator',
        email: 'admin@campus.safety',
        password: 'AdminPassword123!',
      })
      assert.equal(valid.success, true)
    })
  })

  describe('4. Authentication Middleware Enforcement', () => {
    function createMockRes() {
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code
          return this
        },
        json(data) {
          this.body = data
          return this
        },
      }
      return res
    }

    it('rejects requests missing the Authorization header (401)', async () => {
      const req = { headers: {} }
      const res = createMockRes()
      let nextCalled = false

      await authenticateToken(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, false)
      assert.equal(res.statusCode, 401)
      assert.equal(res.body.success, false)
      assert.match(res.body.message, /Authentication required/i)
    })

    it('rejects requests with malformed Bearer prefix (401)', async () => {
      const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } }
      const res = createMockRes()
      let nextCalled = false

      await authenticateToken(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, false)
      assert.equal(res.statusCode, 401)
    })

    it('rejects requests with an invalid JWT token (401)', async () => {
      const req = { headers: { authorization: 'Bearer invalid.token.payload' } }
      const res = createMockRes()
      let nextCalled = false

      await authenticateToken(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, false)
      assert.equal(res.statusCode, 401)
      assert.match(res.body.message, /Invalid authentication token/i)
    })
  })

  describe('5. Role-Based Access Control (RBAC) Enforcement', () => {
    function createMockRes() {
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code
          return this
        },
        json(data) {
          this.body = data
          return this
        },
      }
      return res
    }

    it('allows Administrator to access ADMIN-only endpoint', () => {
      const req = { user: { role: ROLES.ADMIN, name: 'Admin' } }
      const res = createMockRes()
      let nextCalled = false

      const middleware = requireRoles(ROLES.ADMIN)
      middleware(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, true)
      assert.equal(res.statusCode, 200)
    })

    it('blocks Faculty/Staff from accessing ADMIN-only endpoint (403 Role Violation)', () => {
      const req = { user: { role: ROLES.FACULTY_STAFF, name: 'Faculty' } }
      const res = createMockRes()
      let nextCalled = false

      const middleware = requireRoles(ROLES.ADMIN)
      middleware(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, false)
      assert.equal(res.statusCode, 403)
      assert.equal(res.body.success, false)
      assert.match(res.body.message, /Forbidden/i)
      assert.equal(res.body.errors.currentRole, ROLES.FACULTY_STAFF)
      assert.deepEqual(res.body.errors.requiredRoles, [ROLES.ADMIN])
    })

    it('allows Security Officer on multi-role allowed endpoint', () => {
      const req = { user: { role: ROLES.SECURITY_OFFICER, name: 'Officer' } }
      const res = createMockRes()
      let nextCalled = false

      const middleware = requireRoles(ROLES.ADMIN, ROLES.SECURITY_OFFICER)
      middleware(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, true)
    })

    it('blocks Department Head on ADMIN/SECURITY-only endpoint (403)', () => {
      const req = { user: { role: ROLES.DEPT_HEAD, name: 'Dept Head' } }
      const res = createMockRes()
      let nextCalled = false

      const middleware = requireRoles(ROLES.ADMIN, ROLES.SECURITY_OFFICER)
      middleware(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, false)
      assert.equal(res.statusCode, 403)
      assert.equal(res.body.errors.currentRole, ROLES.DEPT_HEAD)
    })

    it('allows Higher Authority on HIGHER_AUTHORITY-allowed endpoint', () => {
      const req = { user: { role: ROLES.HIGHER_AUTHORITY, name: 'VP Safety' } }
      const res = createMockRes()
      let nextCalled = false

      const middleware = requireRoles(ROLES.ADMIN, ROLES.HIGHER_AUTHORITY)
      middleware(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, true)
    })

    it('rejects unauthenticated user in requireRoles (401)', () => {
      const req = { user: null }
      const res = createMockRes()
      let nextCalled = false

      const middleware = requireRoles(ROLES.ADMIN)
      middleware(req, res, () => {
        nextCalled = true
      })

      assert.equal(nextCalled, false)
      assert.equal(res.statusCode, 401)
    })
  })
})
