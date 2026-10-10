import { connectDB, disconnectDB } from '../config/db.js'
import { User } from '../models/User.js'
import { ROLES } from '../config/constants.js'

async function seedAdmin() {
  try {
    console.log('[Seed] Connecting to MongoDB...')
    await connectDB()

    const adminCount = await User.countDocuments({ role: ROLES.ADMIN })
    if (adminCount > 0) {
      console.log('[Seed] Administrator account already exists in database. No action taken.')
      await disconnectDB()
      process.exit(0)
    }

    const name = process.env.INITIAL_ADMIN_NAME || 'Campus Administrator'
    const email = process.env.INITIAL_ADMIN_EMAIL
    const password = process.env.INITIAL_ADMIN_PASSWORD
    const department = process.env.INITIAL_ADMIN_DEPT || 'Campus Safety Directorate'

    if (!email || !email.includes('@')) {
      console.error('[Seed] Error: INITIAL_ADMIN_EMAIL environment variable is required and must be a valid email.')
      console.error('       Example: INITIAL_ADMIN_EMAIL="admin@yourcampus.edu" INITIAL_ADMIN_PASSWORD="YourStrongPassword123!" npm run seed:admin')
      await disconnectDB()
      process.exit(1)
    }

    if (!password || password.length < 8) {
      console.error('[Seed] Error: INITIAL_ADMIN_PASSWORD environment variable is required and must be at least 8 characters.')
      console.error('       Example: INITIAL_ADMIN_EMAIL="admin@yourcampus.edu" INITIAL_ADMIN_PASSWORD="YourStrongPassword123!" npm run seed:admin')
      await disconnectDB()
      process.exit(1)
    }

    const passwordHash = await User.hashPassword(password)

    const admin = await User.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: ROLES.ADMIN,
      department,
      isActive: true,
    })

    console.log(`[Seed] Initial Administrator created successfully:`)
    console.log(`       ID: ${admin._id}`)
    console.log(`       Name: ${admin.name}`)
    console.log(`       Email: ${admin.email}`)
    console.log(`       Role: ${admin.role}`)
    console.log(`       Department: ${admin.department}`)

    await disconnectDB()
    process.exit(0)
  } catch (error) {
    console.error(`[Seed] Failed to seed administrator: ${error.message}`)
    await disconnectDB()
    process.exit(1)
  }
}

seedAdmin()
