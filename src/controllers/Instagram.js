import { metaWebhookAdapter } from "../utils/apiValidation.js";
import { processWebhookEvent } from "../services/facebookService.js";
import { instagramQuerySchema, instagramBodySchema } from "../utils/validation.js";
import prisma from "../config/db.js";
import axios from "axios";

const instagramWebhook = metaWebhookAdapter({
  verifyTokenEnv: "IG_VERIFY_TOKEN",
  querySchema: instagramQuerySchema,
  bodySchema: instagramBodySchema,
  processEvent: processWebhookEvent
});

export const verifyWebhook = instagramWebhook.verifyWebhook;
export const receiveMessage = instagramWebhook.receiveMessage;

// --- Instagram OAuth Business Login ---
export function startInstagramLogin(req, res) {
  const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${process.env.INSTAGRAM_APP_ID}&redirect_uri=${encodeURIComponent(process.env.INSTAGRAM_REDIRECT_URI)}&scope=user_profile,user_media&response_type=code`;
  console.log("OAuth URL: ", authUrl);
  res.redirect(authUrl);
}

export async function instagramCallback(req, res) {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");
  try {
    // Exchange code for access token
    const tokenRes = await axios.post("https://api.instagram.com/oauth/access_token", null, {
      params: {
        client_id: process.env.INSTAGRAM_APP_ID,
        client_secret: process.env.INSTAGRAM_APP_SECRET,
        grant_type: "authorization_code",
        redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
        code
      }
    });
    const { access_token, user_id } = tokenRes.data;
    await prisma.instagramAccount.upsert({
        where: { instagramId: user_id },
        update: { accessToken: access_token },
        create: { instagramId: user_id, accessToken: access_token }
      });
    res.send("Instagram business login successful! You can close this window.");
  } catch (err) {
    res.status(500).send("Instagram login failed: " + err.message);
  }
}