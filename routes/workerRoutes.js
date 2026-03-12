const express = require("express");
const router = express.Router();
const worker = require("../controllers/workerController");
const { authenticateToken } = require("../middleware/authMiddleware");

router.get("/find", worker.findWorkers);
router.get("/profile/:id", worker.getWorkerProfile);
router.get("/jobs", authenticateToken, worker.getWorkerJobs);
router.get("/earnings", authenticateToken, worker.getWorkerEarnings);
router.get("/stats", authenticateToken, worker.getWorkerStats);
router.put("/job-status", authenticateToken, worker.updateJobStatus);

module.exports = router;
