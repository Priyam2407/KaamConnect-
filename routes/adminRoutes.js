const express = require("express");
const router = express.Router();
const admin = require("../controllers/adminController");
const { authenticateToken, authorizeRole } = require("../middleware/authMiddleware");

const adminAuth = [authenticateToken, authorizeRole("admin")];

router.get("/dashboard",             adminAuth, admin.getDashboardStats);
router.get("/users",                 adminAuth, admin.getAllUsers);
router.get("/jobs",                  adminAuth, admin.getAllJobs);
router.post("/verify-worker",        adminAuth, admin.verifyWorker);
router.post("/reject-worker",        adminAuth, admin.rejectWorker);
router.get("/pending-verifications", adminAuth, admin.getPendingVerifications);
router.get("/worker-document/:id",   adminAuth, admin.getWorkerDocument);
router.put("/user-status",           adminAuth, admin.toggleUserStatus);
router.get("/revenue",               adminAuth, admin.getRevenue);
router.delete("/user/:id",           adminAuth, admin.deleteUser);

module.exports = router;