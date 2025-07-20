import { metaWebhookAdapter } from "../utils/apiValidation.js";
import { facebookQuerySchema, facebookBodySchema } from "../utils/validation.js";
import { processWebhookEvent } from "../services/facebookService.js";

const facebookWebhook = metaWebhookAdapter({
  verifyTokenEnv: "FB_VERIFY_TOKEN",
  querySchema: facebookQuerySchema,
  bodySchema: facebookBodySchema,
  processEvent: processWebhookEvent
});

export const verifyWebhook = facebookWebhook.verifyWebhook;
export const receiveMessage = facebookWebhook.receiveMessage;