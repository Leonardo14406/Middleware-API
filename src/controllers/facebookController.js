import { metaWebhookAdapter } from "../utils/apiValidation.js";
import { facebookQuerySchema, facebookBodySchema } from "../utils/validation.js";
import { processWebhookEvent } from "../services/facebookService.js";
import * as dotenv from 'dotenv';

dotenv.config();

const facebookWebhook = metaWebhookAdapter({
  verifyTokenEnv: process.env.FACEBOOK_VERIFY_TOKEN,
  querySchema: facebookQuerySchema,
  bodySchema: facebookBodySchema,
  processEvent: processWebhookEvent
});

export const verifyWebhook = facebookWebhook.verifyWebhook;
export const receiveMessage = facebookWebhook.receiveMessage;
