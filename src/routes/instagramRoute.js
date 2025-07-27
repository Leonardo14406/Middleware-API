import express from "express";
import { getMessages, replyToThread } from "../controllers/instagramController.js";

const router = express.Router();

router.get("/messages/:businessId", getMessages);
router.post("/reply", replyToThread);

export default router;
