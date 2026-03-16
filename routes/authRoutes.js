const express = require("express");
const router  = express.Router();
const auth    = require("../controllers/authController");
const { authenticateToken } = require("../middleware/authMiddleware");

// ── Standard email/password auth ────────────────────────────
router.post("/register",       auth.register);
router.post("/login",          auth.login);
router.get("/profile",         authenticateToken, auth.getProfile);
router.put("/profile",         authenticateToken, auth.updateProfile);
router.put("/change-password", authenticateToken, auth.changePassword);

// ── Google OAuth ─────────────────────────────────────────────
// Step 1: Redirect user to Google consent screen
router.get("/google",          auth.googleAuth);

// Step 2: Google redirects back here with code
router.get("/google/callback", auth.googleCallback);

module.exports = router;