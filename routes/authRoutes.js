const express = require("express");
const router  = express.Router();
const auth    = require("../controllers/authController");
const { authenticateToken } = require("../middleware/authMiddleware");

// ── Email / Password ──────────────────────────────────────────
router.post("/register",       auth.register);
router.post("/login",          auth.login);
router.get("/profile",         authenticateToken, auth.getProfile);
router.put("/profile",         authenticateToken, auth.updateProfile);
router.put("/change-password", authenticateToken, auth.changePassword);

// ── Email Verification ────────────────────────────────────────
router.get("/verify-email",            auth.verifyEmail);
router.post("/resend-verification",    authenticateToken, auth.resendVerification);

// ── Google OAuth ──────────────────────────────────────────────
// Pass ?role=worker or ?role=customer to set role on first signup
router.get("/google",               auth.googleAuth);
router.get("/google/callback",      auth.googleCallback);

// ── Update role after Google signup (called from google-role.html) ─
router.put("/google/role",  authenticateToken, auth.updateGoogleRole);

module.exports = router;