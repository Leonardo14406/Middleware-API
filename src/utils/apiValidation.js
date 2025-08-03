import asyncHandler from "express-async-handler";
import { logger } from "./logger.js";

export function metaWebhookAdapter({ verifyTokenEnv, verifyTokenValidator, querySchema, bodySchema, processEvent }) {
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
      
      let isValidToken = false;
      
      if (verifyTokenValidator) {
        // Use the custom validator function
        isValidToken = await verifyTokenValidator(token);
      } else if (verifyTokenEnv) {
        // Fallback to environment variable check
        isValidToken = token === process.env[verifyTokenEnv];
      }
      
      if (mode === "subscribe" && isValidToken) {
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
        // Handle different webhook structures for different platforms
        let webhookEvents = [];
        
        if (entryItem.messaging) {
          // Facebook/Instagram format
          webhookEvents = entryItem.messaging;
        } else if (entryItem.changes) {
          // WhatsApp format
          webhookEvents = entryItem.changes;
        } else {
          logger.warn("Unknown webhook format", { entryItem });
          return;
        }

        // Process all webhook events in this entry
        const webhookEventPromises = webhookEvents.map(async (webhookEvent) => {
          // Skip non-processable events (delivery confirmations, read receipts, etc.)
          const isProcessableEvent = webhookEvent.message || webhookEvent.postback || webhookEvent.value?.messages;
          if (!isProcessableEvent) {
            logger.debug("Skipping non-processable event", { 
              eventType: Object.keys(webhookEvent).filter(key => !['sender', 'recipient', 'timestamp'].includes(key)),
              senderId: webhookEvent.sender?.id 
            });
            return;
          }

          logger.info("Raw webhook POST received", { body: req.body });
          logger.info("Meta Webhook event received", {
            eventId: webhookEvent.message?.mid || webhookEvent.value?.messages?.[0]?.id,
            timestamp: webhookEvent.timestamp || webhookEvent.value?.messages?.[0]?.timestamp
          });
          try {
            // Normalize WhatsApp webhook events to Facebook format for WhatsApp service
            let normalizedEvent = webhookEvent;
            if (webhookEvent.value?.messages) {
              // WhatsApp format - convert to Facebook format
              const whatsappMessage = webhookEvent.value.messages[0];
              normalizedEvent = {
                sender: { id: whatsappMessage.from },
                timestamp: whatsappMessage.timestamp,
                message: {
                  mid: whatsappMessage.id,
                  text: whatsappMessage.text?.body
                }
              };
            }
            
            await processEvent(normalizedEvent);
          } catch (error) {
            // Defensive: check error and eventId
            const eventId = webhookEvent.message?.mid || webhookEvent.value?.messages?.[0]?.id || "unknown";
            logger.error("Error processing webhook event", {
              error: error && error.message ? error.message : String(error),
              status: error && error.status ? error.status : undefined,
              eventId
            });
          }
        });

        // Wait for all webhook events in this entry to complete
        await Promise.all(webhookEventPromises);
      });

      await Promise.all(eventPromises);
      logger.info(`Processed ${entry.length} entries`);
      res.status(200).json({ status: "EVENTS_PROCESSED", count: entry.length });
    })
  };
}
