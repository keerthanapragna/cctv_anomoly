import { Router } from 'express'
import {
  getAnalyticsOverview,
  getAnalyticsRoles,
  getAnalyticsTrends,
  getAnalyticsWorkload,
  getAnalyticsLeaderboard,
} from '../controllers/analyticsController.js'
import { authenticateToken } from '../middleware/authMiddleware.js'

const router = Router()

// All analytics endpoints require a verified JWT Bearer token
router.use(authenticateToken)

router.get('/overview', getAnalyticsOverview)
router.get('/roles', getAnalyticsRoles)
router.get('/trends', getAnalyticsTrends)
router.get('/workload', getAnalyticsWorkload)
router.get('/leaderboard', getAnalyticsLeaderboard)

export default router
