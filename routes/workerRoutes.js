const express = require("express");
const router  = express.Router();
const worker  = require("../controllers/workerController");
const avail   = require("../controllers/availabilityController");
const { authenticateToken } = require("../middleware/authMiddleware");

router.get("/find",               worker.findWorkers);
router.get("/profile/:id",        worker.getWorkerProfile);
router.get("/jobs",               authenticateToken, worker.getWorkerJobs);
router.get("/earnings",           authenticateToken, worker.getWorkerEarnings);
router.get("/stats",              authenticateToken, worker.getWorkerStats);
router.put("/job-status",         authenticateToken, worker.updateJobStatus);
router.post("/respond-offer",     authenticateToken, worker.respondToOffer);
router.put("/set-price",          authenticateToken, worker.setBasePrice);

// ── Availability ──────────────────────────────────────────────
router.put("/availability",       authenticateToken, avail.setAvailability);
router.get("/availability",       authenticateToken, avail.getAvailability);

// ── Portfolio ─────────────────────────────────────────────────
router.post("/portfolio",         authenticateToken, avail.addPortfolioPhoto);
router.delete("/portfolio/:photoId", authenticateToken, avail.removePortfolioPhoto);

module.exports = router;
