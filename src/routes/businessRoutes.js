import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  registerBusiness,
  getBusinessStatus,
  updateBusiness,
  addPlatformCredentials,
  removePlatformCredentials,
  loginBusiness,
  refreshToken,
} from '../controllers/businessController.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';

const router = express.Router();

// Rate limiter for public endpoints
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: 'Too many requests, please try again later.' },
});

// Rate limiter for authenticated endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per window
  message: { error: 'Too many requests, please try again later.' },
});

// Business management routes
router.post('/register', publicLimiter, registerBusiness);
router.post('/login', publicLimiter, loginBusiness);
router.post('/refresh-token', publicLimiter, refreshToken);
router.get('/status/:businessId', authenticateJWT, authLimiter, getBusinessStatus);
router.put('/business/:businessId', authenticateJWT, authLimiter, updateBusiness);

// Platform credentials management routes
router.post('/platforms/:businessId', authenticateJWT, authLimiter, addPlatformCredentials);
router.delete('/platforms/:businessId', authenticateJWT, authLimiter, removePlatformCredentials);

export default router;