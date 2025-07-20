import express from "express";
import { verifyWebhook, receiveMessage } from "../controllers/Facebook.js";
const router = express.Router();

router.route("/webhook").get(verifyWebhook).post(receiveMessage);

export default router;