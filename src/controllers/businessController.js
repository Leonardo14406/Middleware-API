import prisma from "../config/db.js";
import { loginInstagram } from "../services/instagramService.js";
import { logger } from "../utils/logger.js";

// Register a business and log them in to Instagram
export async function registerBusiness(req, res) {
  const { businessId, username, password } = req.body;

  try {
    const { serialized } = await loginInstagram(username, password);

    await prisma.business.upsert({
      where: { id: businessId },
      update: { instagramSession: serialized },
      create: { id: businessId, instagramSession: serialized },
    });

    res.status(200).json({ message: "Business registered and session saved" });
  } catch (err) {
    logger.logError(err, { context: 'registerBusiness', businessId });
    res.status(500).json({ error: "Instagram login failed" });
  }
}

// Get current status of the business (e.g. whether session exists)
export async function getBusinessStatus(req, res) {
  const { businessId } = req.params;

  try {
    const business = await prisma.business.findUnique({ where: { id: businessId } });

    if (!business) {
      return res.status(404).json({ error: "Business not found" });
    }

    const hasSession = Boolean(business.instagramSession);
    res.status(200).json({ businessId, hasSession });
  } catch (err) {
    logger.logError(err, { context: 'getBusinessStatus', businessId });
    res.status(500).json({ error: "Failed to retrieve business status" });
  }
}

// Update business info (placeholder for now)
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
    logger.logError(err, { context: 'updateBusiness', businessId });
    res.status(500).json({ error: "Failed to update business" });
  }
}
