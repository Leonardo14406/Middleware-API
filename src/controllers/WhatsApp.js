import { metaWebhookAdapter } from "../utils/apiValidation.js";
import { processWhatsAppEvent } from "../services/whatsappService.js";
import { whatsappQuerySchema, whatsappBodySchema } from "../utils/validation.js";

const whatsappWebhook = metaWebhookAdapter({
  verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
  querySchema: whatsappQuerySchema,
  bodySchema: whatsappBodySchema,
  processEvent: processWhatsAppEvent
});

export const verifyWebhook = whatsappWebhook.verifyWebhook;
export const receiveMessage = whatsappWebhook.receiveMessage;