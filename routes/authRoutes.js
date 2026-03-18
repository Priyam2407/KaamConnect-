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

// ── Test Email (development only) ───────────────────────────
router.get("/test-email", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ success: false, message: "Not available in production" });
  }
  const mailer = require("../config/mailer");
  try {
    await mailer.sendVerificationEmail({
      name:  "Test User",
      email: process.env.GMAIL_USER || process.env.SMTP_USER,
      token: "test-token-12345",
    });
    res.json({ success: true, message: "Test email sent! Check your inbox." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, hint: "Check your GMAIL_USER and GMAIL_PASS in .env" });
  }
});

// ── Email Verification ────────────────────────────────────────
router.get("/verify-email",            auth.verifyEmail);
router.post("/resend-verification",    auth.resendVerification);

// ── Google OAuth ──────────────────────────────────────────────
// Pass ?role=worker or ?role=customer to set role on first signup
router.get("/google",               auth.googleAuth);
router.get("/google/callback",      auth.googleCallback);

// ── Update role after Google signup (called from google-role.html) ─
router.put("/google/role",  authenticateToken, auth.updateGoogleRole);

module.exports = router;