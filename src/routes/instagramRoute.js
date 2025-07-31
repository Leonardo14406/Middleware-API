import express from "express";
import {
  getMessages,
  replyToThread,
  loginInstagramHandler
} from "../controllers/instagramController.js";

const router = express.Router();

router.get("/messages/:businessId", getMessages);
router.post("/reply", replyToThread);
router.post("/login", loginInstagramHandler);

export default router;
