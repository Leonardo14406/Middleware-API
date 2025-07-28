import express from "express";
import { getMessages, sendMessage } from "../controllers/facebookController.js";

const router = express.Router();

router.get("/:businessId/messages", getMessages);
router.post("/:businessId/messages", sendMessage);

export default router;
