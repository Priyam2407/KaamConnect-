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
  const mailer = require("../config/mailer");
  const target = process.env.GMAIL_USER || process.env.SMTP_USER;
  try {
    await mailer.sendVerificationEmail({
      name:  "Test User",
      email: target,
      token: "test-token-12345",
    });
    res.json({
      success: true,
      message: "✅ Test email sent to " + target + "! Check your inbox.",
      gmail_user: target,
      node_env:   process.env.NODE_ENV,
      base_url:   process.env.BASE_URL,
    });
  } catch (err) {
    res.status(500).json({
      success:   false,
      error:     err.message,
      gmail_user: target,
      gmail_pass_set: !!(process.env.GMAIL_PASS || process.env.SMTP_PASS),
      gmail_pass_len: (process.env.GMAIL_PASS || process.env.SMTP_PASS || "").length,
      node_env:  process.env.NODE_ENV,
      hint: "If error says 'Invalid login': go to myaccount.google.com/apppasswords and generate a new 16-char App Password",
    });
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