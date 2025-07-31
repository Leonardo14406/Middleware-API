import prisma from "../config/db.js";
import { loginInstagram } from "../services/instagramService.js";
import { loginWhatsApp } from "../services/whatsappService.js";
import { setupWebsite } from "../services/websiteService.js";
import { logger } from "../utils/logger.js";

// Register a business (only business info, no platform authentication)
export async function registerBusiness(req, res) {
  const {
    businessName,
    email,
    password,
    chatbotId,
  } = req.body;

  try {
    // Validate required fields
    if (!businessName || !email || !password || !chatbotId) {
      return res.status(400).json({ 
        error: "Missing required fields: businessName, email, password, chatbotId" 
      });
    }

    // Create the business (generate ID automatically)
    const business = await prisma.business.create({
      data: {
        businessName,
        email,
        password,
        chatbotId,
      },
    });

    res.status(200).json({
      message: "Business registered successfully",
      business: {
        id: business.id,
        businessName: business.businessName,
        email: business.email,
        chatbotId: business.chatbotId,
        createdAt: business.createdAt,
        updatedAt: business.updatedAt,
      },
    });
  } catch (err) {
    logger.logError(err, { context: "registerBusiness" });
    res.status(500).json({ error: "Failed to register business" });
  }
}

// Add all platform credentials for a business
export async function addPlatformCredentials(req, res) {
  const { businessId } = req.params;
  const {
    instagramUsername,
    instagramPassword,
    facebookPageAccessToken,
    whatsappNumber,
    whatsappApiKey,
    websiteUrl,
    websiteApiKey,
  } = req.body;

  try {
    // Check if business exists
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const platformResults = {
      instagram: false,
      facebook: false,
      whatsapp: false,
      website: false,
    };

    // Instagram login and session save
    if (instagramUsername && instagramPassword) {
      try {
        const { serialized: igSerialized } = await loginInstagram(
          instagramUsername,
          instagramPassword,
        );
        await prisma.session.upsert({
          where: {
            businessId_platform: {
              businessId,
              platform: "INSTAGRAM",
            },
          },
          update: {
            serializedCookies: igSerialized,
          },
          create: {
            businessId,
            platform: "INSTAGRAM",
            serializedCookies: igSerialized,
          },
        });
        platformResults.instagram = true;
      } catch (err) {
        logger.logError(err, { context: "Instagram login failed", businessId });
      }
    }

    // Facebook Page Access Token setup
    if (facebookPageAccessToken) {
      try {
        // No need to call loginFacebook or store session for Facebook anymore
        // Just log and mark as configured
        platformResults.facebook = true;
        logger.info("Facebook Page Access Token configured (env-based)", { businessId });
      } catch (err) {
        logger.logError(err, { context: "Facebook setup failed", businessId });
      }
    }

    // WhatsApp setup
    if (whatsappNumber && whatsappApiKey) {
      try {
        const { serialized: whatsappSerialized } = await loginWhatsApp(
          whatsappNumber,
          whatsappApiKey,
        );
        await prisma.session.upsert({
          where: {
            businessId_platform: {
              businessId,
              platform: "WHATSAPP",
            },
          },
          update: {
            serializedCookies: whatsappSerialized,
          },
          create: {
            businessId,
            platform: "WHATSAPP",
            serializedCookies: whatsappSerialized,
          },
        });
        platformResults.whatsapp = true;
        logger.info("WhatsApp credentials configured", { businessId, whatsappNumber });
      } catch (err) {
        logger.logError(err, { context: "WhatsApp setup failed", businessId });
      }
    }

    // Website setup
    if (websiteUrl && websiteApiKey) {
      try {
        const { serialized: websiteSerialized } = await setupWebsite(
          websiteUrl,
          websiteApiKey,
        );
        await prisma.session.upsert({
          where: {
            businessId_platform: {
              businessId,
              platform: "WEBSITE",
            },
          },
          update: {
            serializedCookies: websiteSerialized,
          },
          create: {
            businessId,
            platform: "WEBSITE",
            serializedCookies: websiteSerialized,
          },
        });
        platformResults.website = true;
        logger.info("Website credentials configured", { businessId, websiteUrl });
      } catch (err) {
        logger.logError(err, { context: "Website setup failed", businessId });
      }
    }

    const successCount = Object.values(platformResults).filter(Boolean).length;
    
    res.status(200).json({
      message: `Platform credentials processed. ${successCount} platforms configured successfully.`,
      platforms: platformResults,
      businessId,
    });
  } catch (err) {
    logger.logError(err, { context: "addPlatformCredentials", businessId });
    res.status(500).json({ error: "Failed to add platform credentials" });
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
      return res.status(404).json({ error: "Business not found" });
    }

    const sessions = await prisma.session.findMany({
      where: { businessId },
    });

    const platforms = {
      instagram: sessions.some((s) => s.platform === "INSTAGRAM"),
      facebook: sessions.some((s) => s.platform === "FACEBOOK"),
      whatsapp: sessions.some((s) => s.platform === "WHATSAPP"),
      website: sessions.some((s) => s.platform === "WEBSITE"),
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
    logger.logError(err, { context: "getBusinessStatus", businessId });
    res.status(500).json({ error: "Failed to retrieve business status" });
  }
}

// Update business info
export async function updateBusiness(req, res) {
  const { businessId } = req.params;
  const data = req.body;

  try {
    const updated = await prisma.business.update({
      where: { id: businessId },
      data,
    });

    res.status(200).json({ message: "Business updated", updated });
  } catch (err) {
    logger.logError(err, { context: "updateBusiness", businessId });
    res.status(500).json({ error: "Failed to update business" });
  }
}

// Remove platform credentials for a business
export async function removePlatformCredentials(req, res) {
  const { businessId } = req.params;
  const { platforms } = req.body; // Array of platform names to remove

  try {
    // Check if business exists
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Validate platforms array
    if (!Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ 
        error: "Platforms array is required and must contain at least one platform" 
      });
    }

    const validPlatforms = ["INSTAGRAM", "FACEBOOK", "WHATSAPP", "WEBSITE"];
    const invalidPlatforms = platforms.filter(p => !validPlatforms.includes(p.toUpperCase()));
    
    if (invalidPlatforms.length > 0) {
      return res.status(400).json({ 
        error: `Invalid platforms: ${invalidPlatforms.join(", ")}. Valid platforms are: ${validPlatforms.join(", ")}` 
      });
    }

    // Remove sessions for specified platforms
    const removedSessions = await prisma.session.deleteMany({
      where: {
        businessId,
        platform: {
          in: platforms.map(p => p.toUpperCase()),
        },
      },
    });

    res.status(200).json({
      message: `Successfully removed ${removedSessions.count} platform credentials`,
      businessId,
      removedPlatforms: platforms.map(p => p.toLowerCase()),
      count: removedSessions.count,
    });
  } catch (err) {
    logger.logError(err, { context: "removePlatformCredentials", businessId });
    res.status(500).json({ error: "Failed to remove platform credentials" });
  }
}
