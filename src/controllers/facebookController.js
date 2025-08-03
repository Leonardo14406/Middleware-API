import { metaWebhookAdapter } from "../utils/apiValidation.js";
import { facebookQuerySchema, facebookBodySchema } from "../utils/validation.js";
import { processWebhookEvent } from "../services/facebookService.js";
import prisma from "../config/db.js";
import { logger } from "../utils/logger.js";
import * as dotenv from 'dotenv';

dotenv.config();

// Function to verify token against all businesses
async function verifyFacebookToken(token) {
  try {
    // Check if token matches any business's Facebook verify token
    const business = await prisma.business.findFirst({
      where: {
        facebookVerifyToken: token
      }
    });
    return !!business; // Return true if a business with this token exists
  } catch (error) {
    logger.error("Error verifying Facebook token", { error: error.message });
    return false;
  }
}

const facebookWebhook = metaWebhookAdapter({
  verifyTokenValidator: verifyFacebookToken,
  querySchema: facebookQuerySchema,
  bodySchema: facebookBodySchema,
  processEvent: processWebhookEvent
});

export const verifyWebhook = facebookWebhook.verifyWebhook;
export const receiveMessage = facebookWebhook.receiveMessage;
