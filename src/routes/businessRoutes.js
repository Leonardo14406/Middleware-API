import express from "express";
import {
  registerBusiness,
  getBusinessStatus,
  updateBusiness,
  addPlatformCredentials,
  removePlatformCredentials,
} from "../controllers/businessController.js";

const router = express.Router();

// Business management routes
router.post("/register", registerBusiness);
router.get("/status/:businessId", getBusinessStatus);
router.put("/business/:businessId", updateBusiness);

// Platform credentials management routes
router.post("/platforms/:businessId", addPlatformCredentials);
router.delete("/platforms/:businessId", removePlatformCredentials);

export default router;
