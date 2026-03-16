const express = require("express");
const router  = express.Router();
const auth    = require("../controllers/authController");
const { authenticateToken } = require("../middleware/authMiddleware");

// ── Email / Password ─────────────────────────────────────────
router.post("/register",       auth.register);
router.post("/login",          auth.login);
router.get("/profile",         authenticateToken, auth.getProfile);
router.put("/profile",         authenticateToken, auth.updateProfile);
router.put("/change-password", authenticateToken, auth.changePassword);

// ── Google OAuth ─────────────────────────────────────────────
router.get("/google",          auth.googleAuth);      // Step 1: redirect to Google
router.get("/google/callback", auth.googleCallback);  // Step 2: Google redirects back

module.exports = router;