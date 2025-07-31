import express from "express";
import {
  registerBusiness,
  getBusinessStatus,
  updateBusiness,
  addPlatformCredentials,
  removePlatformCredentials,
  loginBusiness,
} from "../controllers/businessController.js";
import { authenticateJWT } from "../middleware/authMiddleware.js";

const router = express.Router();

// Business management routes
router.post("/register", registerBusiness);
router.post("/login", loginBusiness);
router.get("/status/:businessId", authenticateJWT, getBusinessStatus);
router.put("/business/:businessId", authenticateJWT, updateBusiness);

// Platform credentials management routes
router.post("/platforms/:businessId", authenticateJWT, addPlatformCredentials);
router.delete("/platforms/:businessId", authenticateJWT, removePlatformCredentials);

export default router;
