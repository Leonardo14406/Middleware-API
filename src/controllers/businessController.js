import prisma from '../config/db.js';
import { loginInstagram } from '../services/instagramService.js';
import { loginWhatsApp } from '../services/whatsappService.js'; // Mocked if not implemented
import { logger } from '../utils/logger.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { pollingService } from '../services/pollingService.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import validator from 'validator';

// Register a business
export async function registerBusiness(req, res) {
  const { businessName, email, password, chatbotId } = req.body;
  const requestId = `reg_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  try {
    if (!businessName || !email || !password || !chatbotId) {
      return res.status(400).json({ 
        error: 'Missing required fields: businessName, email, password, chatbotId' 
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existingBusiness = await prisma.business.findUnique({ where: { email } });
    if (existingBusiness) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const business = await prisma.business.create({
      data: {
        businessName,
        email,
        password: hashedPassword,
        chatbotId,
      },
    });

    const token = jwt.sign(
      { businessId: business.id, email: business.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    logger.info('Business registered successfully', { requestId, businessId: business.id, email, chatbotId });
    res.status(200).json({
      message: 'Business registered successfully',
      business: {
        id: business.id,
        businessName: business.businessName,
        email: business.email,
        chatbotId: business.chatbotId,
        createdAt: business.createdAt,
        updatedAt: business.updatedAt,
      },
      token,
    });
  } catch (err) {
    logger.error('Failed to register business', { requestId, email, error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to register business' });
  }
}

// Add platform credentials for a business
export async function addPlatformCredentials(req, res) {
  const { businessId } = req.params;
  const { instagramUsername, instagramPassword, facebookPageAccessToken, facebookVerifyToken, whatsappBearerToken, whatsappVerifyToken } = req.body;
  const requestId = `plat_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  try {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (!instagramUsername && !facebookPageAccessToken && !whatsappBearerToken) {
      return res.status(400).json({ error: 'At least one platform credential is required' });
    }

    const platformResults = { instagram: false, facebook: false, whatsapp: false };

    // Clean up stale sessions
    await prisma.session.deleteMany({ where: { businessId } });

    if (instagramUsername && instagramPassword) {
      try {
        if (!instagramUsername || instagramUsername.trim() === '') {
          throw new Error('Instagram username cannot be empty');
        }
        const { serialized: igSerialized } = await loginInstagram(instagramUsername, instagramPassword, businessId);
        await prisma.session.upsert({
          where: { businessId_platform: { businessId, platform: 'INSTAGRAM' } },
          update: {
            serializedCookies: igSerialized,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          },
          create: {
            businessId,
            platform: 'INSTAGRAM',
            serializedCookies: igSerialized,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        await prisma.business.update({
          where: { id: businessId },
          data: { instagramUsername },
        });
        await pollingService.startPolling(businessId);
        platformResults.instagram = true;
        logger.info('Instagram credentials added and polling started', { requestId, businessId, instagramUsername });
      } catch (err) {
        logger.error('Instagram login failed', { requestId, businessId, instagramUsername, error: err.message, stack: err.stack });
        platformResults.instagram = err.message;
      }
    }

    if (facebookPageAccessToken && facebookVerifyToken) {
      try {
        if (!validator.isAlphanumeric(facebookPageAccessToken.replace(/[-_]/g, '')) || !validator.isAlphanumeric(facebookVerifyToken.replace(/[-_]/g, ''))) {
          throw new Error('Invalid Facebook token format');
        }
        const encryptedAccessToken = await encrypt(facebookPageAccessToken);
        const encryptedVerifyToken = await encrypt(facebookVerifyToken);
        await prisma.session.upsert({
          where: { businessId_platform: { businessId, platform: 'FACEBOOK' } },
          update: {
            serializedCookies: JSON.stringify({ accessToken: encryptedAccessToken, verifyToken: encryptedVerifyToken }),
            updatedAt: new Date(),
          },
          create: {
            businessId,
            platform: 'FACEBOOK',
            serializedCookies: JSON.stringify({ accessToken: encryptedAccessToken, verifyToken: encryptedVerifyToken }),
          },
        });
        await prisma.business.update({
          where: { id: businessId },
          data: { facebookPageAccessToken: encryptedAccessToken, facebookVerifyToken: encryptedVerifyToken },
        });
        platformResults.facebook = true;
        logger.info('Facebook credentials configured', { requestId, businessId });
      } catch (err) {
        logger.error('Facebook setup failed', { requestId, businessId, error: err.message, stack: err.stack });
        platformResults.facebook = err.message;
      }
    }

    if (whatsappBearerToken && whatsappVerifyToken) {
      try {
        if (!validator.isAlphanumeric(whatsappBearerToken.replace(/[-_]/g, '')) || !validator.isAlphanumeric(whatsappVerifyToken.replace(/[-_]/g, ''))) {
          throw new Error('Invalid WhatsApp token format');
        }
        const { serialized: whatsappSerialized } = await effectiveLoginWhatsApp(whatsappBearerToken, whatsappVerifyToken, businessId);
        const encryptedBearerToken = await encrypt(whatsappBearerToken);
        const encryptedVerifyToken = await encrypt(whatsappVerifyToken);
        await prisma.session.upsert({
          where: { businessId_platform: { businessId, platform: 'WHATSAPP' } },
          update: {
            serializedCookies: whatsappSerialized,
            updatedAt: new Date(),
          },
          create: {
            businessId,
            platform: 'WHATSAPP',
            serializedCookies: whatsappSerialized,
          },
        });
        await prisma.business.update({
          where: { id: businessId },
          data: { whatsappBearerToken: encryptedBearerToken, whatsappVerifyToken: encryptedVerifyToken },
        });
        platformResults.whatsapp = true;
        logger.info('WhatsApp credentials configured', { requestId, businessId });
      } catch (err) {
        logger.error('WhatsApp setup failed', { requestId, businessId, error: err.message, stack: err.stack });
        platformResults.whatsapp = err.message;
      }
    }

    const successCount = Object.values(platformResults).filter(v => v === true).length;
    const errors = Object.entries(platformResults)
      .filter(([_, v]) => v !== true && v !== false)
      .map(([platform, error]) => ({ platform, error }));

    if (successCount === 0 && errors.length > 0) {
      return res.status(400).json({
        error: 'No platforms configured successfully',
        errors,
        businessId,
      });
    }

    res.status(200).json({
      message: `Platform credentials processed. ${successCount} platforms configured successfully.`,
      platforms: platformResults,
      errors: errors.length > 0 ? errors : undefined,
      businessId,
    });
  } catch (err) {
    logger.error('Failed to add platform credentials', { requestId, businessId, error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to add platform credentials' });
  }
}

// Check if session exists for all platforms
export async function getBusinessStatus(req, res) {
  const { businessId } = req.params;
  const requestId = `status_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { sessions: true },
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const platforms = {
      instagram: business.sessions.some(s => s.platform === 'INSTAGRAM' && s.expiresAt > new Date()),
      facebook: !!business.facebookPageAccessToken,
      whatsapp: !!business.whatsappBearerToken,
    };

    res.status(200).json({
      businessId,
      business: {
        businessName: business.businessName,
        email: business.email,
        chatbotId: business.chatbotId,
        instagramUsername: business.instagramUsername || null,
        createdAt: business.createdAt,
        updatedAt: business.updatedAt,
      },
      platforms,
      totalPlatforms: Object.values(platforms).filter(Boolean).length,
    });
    logger.info('Business status retrieved', { requestId, businessId, platforms });
  } catch (err) {
    logger.error('Failed to retrieve business status', { requestId, businessId, error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to retrieve business status' });
  }
}

// Update business info
export async function updateBusiness(req, res) {
  const { businessId } = req.params;
  const { businessName, email, password, chatbotId } = req.body;
  const requestId = `update_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  try {
    if (!businessName && !email && !password && !chatbotId) {
      return res.status(400).json({ error: 'At least one field is required to update' });
    }

    if (email && !validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password && password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const data = {};
    if (businessName) data.businessName = businessName;
    if (email) data.email = email;
    if (password) data.password = await bcrypt.hash(password, SALT_ROUNDS);
    if (chatbotId) data.chatbotId = chatbotId;

    const updated = await prisma.business.update({
      where: { id: businessId },
      data,
    });

    res.status(200).json({
      message: 'Business updated successfully',
      business: {
        id: updated.id,
        businessName: updated.businessName,
        email: updated.email,
        chatbotId: updated.chatbotId,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
    logger.info('Business updated successfully', { requestId, businessId, updatedFields: Object.keys(data) });
  } catch (err) {
    logger.error('Failed to update business', { requestId, businessId, error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to update business' });
  }
}

// Remove platform credentials for a business
export async function removePlatformCredentials(req, res) {
  const { businessId } = req.params;
  const { platforms } = req.body;
  const requestId = `remove_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  try {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    if (!Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ 
        error: 'Platforms array is required and must contain at least one platform' 
      });
    }

    const validPlatforms = ['INSTAGRAM', 'FACEBOOK', 'WHATSAPP'];
    const invalidPlatforms = platforms.filter(p => !validPlatforms.includes(p.toUpperCase()));
    
    if (invalidPlatforms.length > 0) {
      return res.status(400).json({ 
        error: `Invalid platforms: ${invalidPlatforms.join(', ')}. Valid platforms are: ${validPlatforms.join(', ')}` 
      });
    }

    const data = {};
    if (platforms.includes('INSTAGRAM')) {
      data.instagramUsername = null;
      await pollingService.stopPolling(businessId);
    }
    if (platforms.includes('FACEBOOK')) {
      data.facebookPageAccessToken = null;
      data.facebookVerifyToken = null;
    }
    if (platforms.includes('WHATSAPP')) {
      data.whatsappBearerToken = null;
      data.whatsappVerifyToken = null;
    }

    await prisma.business.update({
      where: { id: businessId },
      data,
    });

    const removedSessions = await prisma.session.deleteMany({
      where: {
        businessId,
        platform: { in: platforms.map(p => p.toUpperCase()) },
      },
    });

    res.status(200).json({
      message: `Successfully removed ${removedSessions.count} platform credentials`,
      businessId,
      removedPlatforms: platforms.map(p => p.toLowerCase()),
      count: removedSessions.count,
    });
    logger.info('Platform credentials removed successfully', { requestId, businessId, removedPlatforms: platforms });
  } catch (err) {
    logger.error('Failed to remove platform credentials', { requestId, businessId, error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to remove platform credentials' });
  }
}

// Login a business and return JWT token
export async function loginBusiness(req, res) {
  const { email, password } = req.body;
  const requestId = `login_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  try {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const business = await prisma.business.findUnique({ where: { email } });
    if (!business) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, business.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { businessId: business.id, email: business.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({
      message: 'Login successful',
      token,
      business: {
        id: business.id,
        businessName: business.businessName,
        email: business.email,
        chatbotId: business.chatbotId,
      },
    });
    logger.info('Business logged in successfully', { requestId, businessId: business.id, email });
  } catch (err) {
    logger.error('Failed to login business', { requestId, email, error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to login' });
  }
}

// Refresh JWT token
export async function refreshToken(req, res) {
  const { token } = req.body;
  const requestId = `refresh_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  try {
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const business = await prisma.business.findUnique({ where: { id: decoded.businessId } });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const newToken = jwt.sign(
      { businessId: business.id, email: business.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({
      message: 'Token refreshed successfully',
      token: newToken,
      business: {
        id: business.id,
        businessName: business.businessName,
        email: business.email,
        chatbotId: business.chatbotId,
      },
    });
    logger.info('Token refreshed successfully', { requestId, businessId: business.id, email: business.email });
  } catch (err) {
    logger.error('Failed to refresh token', { requestId, error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to refresh token' });
  }
}