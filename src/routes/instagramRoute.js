import express from "express";
import { verifyWebhook, receiveMessage, startInstagramLogin, instagramCallback } from "../controllers/Instagram.js";
const router = express.Router();

router.route("/webhook").get(verifyWebhook).post(receiveMessage);
router.get("/login", startInstagramLogin);
router.get("/callback", instagramCallback);

export default router;