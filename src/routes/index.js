import express from "express";
import facebookRoute from "./facebookRoute.js";
import instagramRoute from "./instagramRoute.js";
import whatsAppRoute from "./whatsAppRoute.js";

const router = express.Router();

router.use("/facebook", facebookRoute);
router.use("/instagram", instagramRoute);
router.use("/whatsapp", whatsAppRoute);

export default router;
