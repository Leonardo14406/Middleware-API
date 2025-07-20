// Utility functions
import asyncHandler from "express-async-handler";
import { logger } from "../server.js";

export function metaWebhookAdapter({ verifyTokenEnv, querySchema, bodySchema, processEvent }) {
  return {
    verifyWebhook: asyncHandler(async (req, res) => {
      const { error, value } = querySchema.validate(req.query, { stripUnknown: true });
      if (error) {
        logger.warn("Validation failed", { details: error.details });
        return res.status(400).json({ error: "Invalid request parameters" });
      }
      const mode = value["hub.mode"];
      const token = value["hub.verify_token"];
      const challenge = value["hub.challenge"];
      if (mode === "subscribe" && token === process.env[verifyTokenEnv]) {
        logger.info("Webhook verified successfully", { mode, challenge });
        res.status(200).send(challenge);
      } else {
        logger.warn("Invalid verification token attempt", { mode, token: "REDACTED" });
        res.status(403).json({ error: "Invalid verification token" });
      }
    }),
    receiveMessage: asyncHandler(async (req, res) => {
      let payload = req.body;

      if (!payload.entry && payload.sender && payload.recipient && payload.message) {
        payload = {
          entry: [
            {
              messaging: [payload]
            }
          ]
        };
      }

      // Validate the normalized payload
      const { error, value } = bodySchema.validate(payload, { stripUnknown: true });
      if (error) {
        logger.warn("Invalid webhook payload", { details: error.details });
        return res.status(400).json({ error: "Invalid webhook payload" });
      }

      const { entry } = value;
      const eventPromises = entry.map(async (entryItem) => {
        const webhookEvents = entryItem.messaging;
        for (const webhookEvent of webhookEvents) {
          logger.info("Raw webhook POST received", { body: req.body });
          logger.info("Meta Webhook event received", {
            eventId: webhookEvent.message?.mid,
            timestamp: webhookEvent.timestamp
          });
          try {
            await processEvent(webhookEvent);
          } catch (error) {
            logger.error("Error processing webhook event", {
              error: error.message,
              eventId: webhookEvent.message?.mid
            });
          }
        }
      });

      await Promise.all(eventPromises);
      logger.info(`Processed ${entry.length} entries`);
      res.status(200).json({ status: "EVENTS_PROCESSED", count: entry.length });
    })
  };
}

