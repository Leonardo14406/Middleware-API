import prisma from "../config/db.js";
import { loginInstagram } from "../services/instagramService.js";
import { loginFacebook } from "../services/facebookService.js";
import { logger } from "../utils/logger.js";

// Register a business and log them into Instagram & Facebook
export async function registerBusiness(req, res) {
  const {
    businessId,
    igUsername,
    chatbotId,
    email,
    instagramUsername,
    instagramPassword,
    facebookEmail,
    facebookPassword,
  } = req.body;

  try {
    // Ensure the business exists or create it
    const business = await prisma.business.upsert({
      where: { id: businessId },
      update: {
        igUsername,
        chatbotId,
        email,
      },
      create: {
        id: businessId,
        igUsername,
        chatbotId,
        email,
      },
    });

    // Instagram login and session save
    if (instagramUsername && instagramPassword) {
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
    }

    // Facebook login and session save
    if (facebookEmail && facebookPassword) {
      const { serialized: fbSerialized } = await loginFacebook(
        facebookEmail,
        facebookPassword,
      );
      await prisma.session.upsert({
        where: {
          businessId_platform: {
            businessId,
            platform: "FACEBOOK",
          },
        },
        update: {
          serializedCookies: fbSerialized,
        },
        create: {
          businessId,
          platform: "FACEBOOK",
          serializedCookies: fbSerialized,
        },
      });
    }

    res.status(200).json({
      message: "Business registered and sessions saved",
      services: {
        instagram: Boolean(instagramUsername && instagramPassword),
        facebook: Boolean(facebookEmail && facebookPassword),
      },
    });
  } catch (err) {
    logger.logError(err, { context: "registerBusiness", businessId });
    res.status(500).json({ error: "Failed to register or log into services" });
  }
}

// Check if session exists for Instagram or Facebook
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

    const hasInstagram = sessions.some((s) => s.platform === "INSTAGRAM");
    const hasFacebook = sessions.some((s) => s.platform === "FACEBOOK");

    res.status(200).json({
      businessId,
      sessions: {
        instagram: hasInstagram,
        facebook: hasFacebook,
      },
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
