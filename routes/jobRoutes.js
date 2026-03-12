const express = require("express");
const router = express.Router();
const job = require("../controllers/jobController");
const { authenticateToken } = require("../middleware/authMiddleware");

router.post("/create", authenticateToken, job.createJob);
router.get("/customer", authenticateToken, job.getCustomerJobs);
router.put("/cancel/:id", authenticateToken, job.cancelJob);
router.post("/review", authenticateToken, job.submitReview);
router.get("/stats", authenticateToken, job.getCustomerStats);
router.get("/notifications", authenticateToken, job.getNotifications);
router.put("/notifications/read", authenticateToken, job.markNotificationsRead);

module.exports = router;
