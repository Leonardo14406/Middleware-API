import express from "express";
import { verifyWebhook, receiveMessage } from "../controllers/facebookController.js";

const router = express.Router();

// Webhook verification and message handling
router.route("/webhook").get(verifyWebhook).post(receiveMessage);

export default router;
