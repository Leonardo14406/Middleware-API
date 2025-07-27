import express from "express";
import {
  registerBusiness,
  getBusinessStatus,
  updateBusiness,
} from "../controllers/businessController.js";

const router = express.Router();

router.post("/register", registerBusiness);
router.get("/status/:businessId", getBusinessStatus);
router.put("/business/:businessId", updateBusiness);

export default router;
