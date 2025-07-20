import express from "express";
import { verifyWebhook, receiveMessage } from "../controllers/WhatsApp.js";
const router = express.Router();

router.route("/webhook").get(verifyWebhook).post(receiveMessage);

export default router;