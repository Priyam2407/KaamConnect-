const express = require("express");
const router  = express.Router();
const sub     = require("../controllers/subscriptionController");
const { authenticateToken } = require("../middleware/authMiddleware");

router.get("/plans",           sub.getPlans);
router.get("/status",          authenticateToken, sub.getStatus);
router.post("/activate",       authenticateToken, sub.activatePlan);

module.exports = router;
