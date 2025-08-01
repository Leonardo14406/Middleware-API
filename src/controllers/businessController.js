import prisma from '../config/db.js';
import { loginInstagram } from '../services/instagramService.js';
import { loginWhatsApp } from '../services/whatsappService.js';
import { logger } from '../utils/logger.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { pollingService } from '../services/pollingService.js';
import jwt from 'jsonwebtoken';

// Register a business (only business info, no platform authentication)
export async function registerBusiness(req, res) {
  const { businessName, email, password, chatbotId } = req.body;

  try {
    if (!businessName || !email || !password || !chatbotId) {
      return res.status(400).json({ 
        error: 'Missing required fields: businessName, email, password, chatbotId' 
      });
    }

    const existingBusiness = await prisma.business.findUnique({ where: { email } });
    if (existingBusiness) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const business = await prisma.business.create({
      data: {
        businessName,
        email,
        password: await encrypt(password),
        chatbotId,
      },
    });

    const token = jwt.sign(
      { businessId: business.id, email: business.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    logger.info('Business registered successfully', { businessId: business.id, email });
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
    logger.logError(err, { context: 'registerBusiness', email });
    res.status(500).json({ error: 'Failed to register business' });
  }
}

// Add all platform credentials for a business
export async function addPlatformCredentials(req, res) {
  const { businessId } = req.params;
  const { instagramUsername, instagramPassword, facebookPageAccessToken, facebookVerifyToken, whatsappBearerToken, whatsappVerifyToken } = req.body;

  try {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const platformResults = { instagram: false, facebook: false, whatsapp: false };

    if (instagramUsername && instagramPassword) {
      try {
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
          data: { igUsername: instagramUsername },
        });
        await pollingService.startPolling(businessId);
        platformResults.instagram = true;
        logger.info('Instagram credentials added and polling started', { businessId, instagramUsername });
      } catch (err) {
        logger.logError(err, { context: 'Instagram login failed', businessId, instagramUsername });
      }
    }

    if (facebookPageAccessToken && facebookVerifyToken) {
      try {
        await prisma.business.update({
          where: { id: businessId },
          data: { facebookPageAccessToken, facebookVerifyToken },
        });
        platformResults.facebook = true;
        logger.info('Facebook credentials configured', { businessId });
      } catch (err) {
        logger.logError(err, { context: 'Facebook setup failed', businessId });
      }
    }

    if (whatsappBearerToken && whatsappVerifyToken) {
      try {
        const { serialized: whatsappSerialized } = await loginWhatsApp(whatsappBearerToken, whatsappVerifyToken, businessId);
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
          data: { whatsappBearerToken, whatsappVerifyToken },
        });
        platformResults.whatsapp = true;
        logger.info('WhatsApp credentials configured', { businessId });
      } catch (err) {
        logger.logError(err, { context: 'WhatsApp setup failed', businessId });
      }
    }

    const successCount = Object.values(platformResults).filter(Boolean).length;
    res.status(200).json({
      message: `Platform credentials processed. ${successCount} platforms configured successfully.`,
      platforms: platformResults,
      businessId,
    });
  } catch (err) {
    logger.logError(err, { context: 'addPlatformCredentials', businessId });
    res.status(500).json({ error: 'Failed to add platform credentials' });
  }
}

// Check if session exists for all platforms
export async function getBusinessStatus(req, res) {
  const { businessId } = req.params;

  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const sessions = await prisma.session.findMany({
      where: { businessId },
    });

    const platforms = {
      instagram: sessions.some((s) => s.platform === 'INSTAGRAM'),
      facebook: sessions.some((s) => s.platform === 'FACEBOOK') || !!business.facebookPageAccessToken,
      whatsapp: sessions.some((s) => s.platform === 'WHATSAPP') || !!business.whatsappBearerToken,
    };

    res.status(200).json({
      businessId,
      business: {
        businessName: business.businessName,
        email: business.email,
        chatbotId: business.chatbotId,
        igUsername: business.igUsername || null,
        createdAt: business.createdAt,
        updatedAt: business.updatedAt,
      },
      platforms,
      totalPlatforms: Object.values(platforms).filter(Boolean).length,
    });
  } catch (err) {
    logger.logError(err, { context: 'getBusinessStatus', businessId });
    res.status(500).json({ error: 'Failed to retrieve business status' });
  }
}

// Update business info
export async function updateBusiness(req, res) {
  const { businessId } = req.params;
  const { businessName, email, password, chatbotId } = req.body;

  try {
    const data = {};
    if (businessName) data.businessName = businessName;
    if (email) data.email = email;
    if (password) data.password = await encrypt(password);
    if (chatbotId) data.chatbotId = chatbotId;

    const updated = await prisma.business.update({
      where: { id: businessId },
      data,
    });

    res.status(200).json({ message: 'Business updated', updated });
  } catch (err) {
    logger.logError(err, { context: 'updateBusiness', businessId });
    res.status(500).json({ error: 'Failed to update business' });
  }
}

// Remove platform credentials for a business
export async function removePlatformCredentials(req, res) {
  const { businessId } = req.params;
  const { platforms } = req.body;

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
      data.igUsername = null;
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
  } catch (err) {
    logger.logError(err, { context: 'removePlatformCredentials', businessId });
    res.status(500).json({ error: 'Failed to remove platform credentials' });
  }
}

// Login a business and return JWT token
export async function loginBusiness(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const business = await prisma.business.findUnique({ where: { email } });
    if (!business) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const decryptedPassword = await decrypt(business.password);
    if (password !== decryptedPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { businessId: business.id, email: business.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    logger.info('Business logged in successfully', { businessId: business.id, email });
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
  } catch (err) {
    logger.logError(err, { context: 'loginBusiness', email });
    res.status(500).json({ error: 'Failed to login' });
  }
}