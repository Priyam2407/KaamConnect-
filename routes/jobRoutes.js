const express = require("express");
const router  = express.Router();
const job     = require("../controllers/jobController");
const avail   = require("../controllers/availabilityController");
const { authenticateToken } = require("../middleware/authMiddleware");

router.post("/create",              authenticateToken, job.createJob);
router.get("/customer",             authenticateToken, job.getCustomerJobs);
router.post("/offer",               authenticateToken, job.sendCustomerOffer);
router.post("/accept-price",        authenticateToken, job.acceptWorkerPrice);
router.get("/offers/:job_id",       authenticateToken, job.getJobOffers);
router.put("/cancel/:id",           authenticateToken, job.cancelJob);
router.post("/review",              authenticateToken, job.submitReview);
router.delete("/review/:job_id",    authenticateToken, job.deleteReview);
router.get("/stats",                authenticateToken, job.getCustomerStats);
router.get("/notifications",        authenticateToken, job.getNotifications);
router.put("/notifications/read",   authenticateToken, job.markNotificationsRead);

// ── Re-book ───────────────────────────────────────────────────
router.post("/rebook",              authenticateToken, avail.rebookWorker);

module.exports = router;