const { User, PendingUser } = require("../models");
const jwt      = require("jsonwebtoken");
const passport = require("passport");
const crypto   = require("crypto");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const mailer   = require("../config/mailer");

// ─── JWT helper ──────────────────────────────────────────────
const signToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: "7d" });

// ─── Google OAuth Strategy ────────────────────────────────────
passport.use(
  new GoogleStrategy(
    {
      clientID:          process.env.GOOGLE_CLIENT_ID,
      clientSecret:      process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:       `${process.env.BASE_URL}/api/auth/google/callback`,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        // 1. Already has Google account → log in directly
        let user = await User.findOne({ googleId: profile.id });
        if (user) return done(null, { user, isNew: false });

        // 2. Email already registered with password → link Google
        user = await User.findOne({ email: profile.emails[0].value });
        if (user) {
          user.googleId = profile.id;
          if (!user.avatar) user.avatar = profile.photos[0]?.value || null;
          await user.save();
          return done(null, { user, isNew: false });
        }

        // 3. Brand new user → create with customer role temporarily
        //    Role + worker details updated on google-role.html
        user = await User.create({
          name:     profile.displayName,
          email:    profile.emails[0].value,
          googleId: profile.id,
          avatar:   profile.photos[0]?.value || null,
          role:     "customer",
          password: "google_oauth_" + profile.id,
          verified: true,
        });

        return done(null, { user, isNew: true });
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// ─── Register ─────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, password, phone, role, skill, location, bio, idType, idDocument } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "Name, email and password required" });

    // Block if already a verified real user
    const existing = await User.findOne({ email });
    if (existing)
      return res.status(409).json({ success: false, message: "Email already registered" });

    // Remove any previous pending registration for this email
    await PendingUser.deleteOne({ email });

    // Hash password before storing in pending
    const bcrypt = require("bcryptjs");
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate verification token
    const verifyToken = crypto.randomBytes(32).toString("hex");
    const expiresAt   = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    // Save registration data temporarily — NOT in User collection yet
    await PendingUser.create({
      name, email,
      password:   hashedPassword,
      phone:      phone   || undefined,
      role:       role    || "customer",
      skill:      skill   || undefined,
      location:   location || undefined,
      bio:        bio     || undefined,
      idType:     idType  || undefined,
      idDocument: idDocument || undefined,
      verifyToken,
      expiresAt,
    });

    // Send verification email
    try {
      await mailer.sendVerificationEmail({ name, email, token: verifyToken });
      console.log("[Register] Verification email sent to:", email);
    } catch (emailErr) {
      // If email fails, clean up and tell the user
      await PendingUser.deleteOne({ email });
      console.error("[Register] Email failed:", emailErr.message);
      return res.status(500).json({
        success: false,
        message: "Could not send verification email. Please check your email address and try again.",
      });
    }

    // Respond — NO token, NO user object yet (account not created)
    res.json({
      success:   true,
      pending:   true,
      emailSent: true,
      message:   "Verification email sent! Please check your inbox and click the link to complete your registration.",
      email,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Login ────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password required" });

    const user = await User.findOne({ email, isActive: true }).select("+password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (user.googleId && user.password && user.password.startsWith("google_oauth_"))
      return res.status(401).json({ success: false, message: "This account uses Google Sign-In. Please click 'Continue with Google'." });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ success: false, message: "Invalid password" });

    // Block login if email not verified (skip for Google-auth users & admins)
    if (!user.googleId && user.role !== "admin" && user.emailVerified === false) {
      const token = signToken(user._id, user.role); // give token so they can resend
      return res.status(403).json({
        success:       false,
        emailUnverified: true,
        message:       "Please verify your email before logging in. Check your inbox or resend the verification email.",
        token,
        email:         user.email,
      });
    }

    const token = signToken(user._id, user.role);
    res.json({
      success: true, message: "Login successful", token,
      user: {
        id: user._id, name: user.name, email: user.email, role: user.role,
        skill: user.skill, location: user.location, avatar: user.avatar,
        verified: user.verified, rating: user.rating, subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Google Auth — Step 1 ────────────────────────────────────
exports.googleAuth = passport.authenticate("google", {
  scope:   ["profile", "email"],
  session: false,
});

// ─── Google Auth — Step 2: callback ──────────────────────────
exports.googleCallback = (req, res) => {
  passport.authenticate("google", { session: false }, (err, result) => {
    if (err || !result) {
      console.error("Google OAuth error:", err);
      return res.redirect("/login.html?error=google_failed");
    }

    const { user, isNew } = result;
    const token    = signToken(user._id, user.role);
    // NOTE: avatar intentionally excluded from URL to prevent 502 (header too large)
    // Avatar is saved in DB and loaded via /api/auth/profile on dashboard
    const userData = encodeURIComponent(JSON.stringify({
      id:       user._id,
      name:     user.name,
      email:    user.email,
      role:     user.role,
      skill:    user.skill    || null,
      location: user.location || null,
    }));

    // NEW user → role selection page first
    if (isNew) {
      return res.redirect(`/google-role.html?token=${token}&user=${userData}`);
    }

    // EXISTING user → straight to their dashboard
    const dest = user.role === "admin"  ? "admin-dashboard.html"
               : user.role === "worker" ? "worker-dashboard.html"
               : "customer-dashboard.html";

    res.redirect(`/${dest}?token=${token}&user=${userData}`);
  })(req, res);
};

// ─── Update role + worker details (called from google-role.html) ─
exports.updateGoogleRole = async (req, res) => {
  try {
    const { role, skill, location, phone, bio, idType, idDocument, password } = req.body;

    if (!["customer", "worker"].includes(role))
      return res.status(400).json({ success: false, message: "Invalid role" });

    // Validate password if provided
    if (password && password.length < 6)
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });

    const updateData = { role };

    // Common fields for both roles
    if (phone)    updateData.phone    = phone;
    if (location) updateData.location = location;

    // If worker, save all extra details
    if (role === "worker") {
      if (skill)      updateData.skill = skill;
      if (bio)        updateData.bio   = bio;
      if (idType)     updateData.idType = idType;
      if (idDocument) {
        updateData.idDocument = idDocument;
        updateData.idStatus   = "pending";
      }
    }

    // Save password if provided (allows Google users to also login with email/password)
    const user = await User.findById(req.user.id);
    if (password) {
      user.password = password; // model pre-save will hash it
    }
    Object.assign(user, updateData);
    await user.save();

    const updatedUser = await User.findById(req.user.id);
    const token = signToken(updatedUser._id, updatedUser.role);

    res.json({
      success: true, token,
      user: {
        id:       updatedUser._id,
        name:     updatedUser.name,
        email:    updatedUser.email,
        role:     updatedUser.role,
        phone:    updatedUser.phone    || null,
        location: updatedUser.location || null,
        skill:    updatedUser.skill    || null,
        avatar:   updatedUser.avatar   || null,
        idStatus: updatedUser.idStatus || "none",
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Get Profile ─────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ─── Update Profile ───────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, location, bio, skill, avatar } = req.body;
    const update = { name, phone, location, bio, skill };
    // avatar can be a base64 data URL, a URL string, or null (to delete)
    if (avatar !== undefined) update.avatar = avatar;
    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true });
    res.json({ success: true, message: "Profile updated successfully", avatar: user.avatar || null });
  } catch (err) {
    res.status(500).json({ success: false, message: "Update failed" });
  }
};

// ─── Change Password ──────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select("+password");
    if (user.googleId && user.password.startsWith("google_oauth_"))
      return res.status(400).json({ success: false, message: "Google accounts cannot change password here." });
    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ success: false, message: "Current password is incorrect" });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Password update failed" });
  }
};

// ─── Verify Email ─────────────────────────────────────────────
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send(emailResult("error", "Invalid verification link."));

    // Check pending registration
    const pending = await PendingUser.findOne({
      verifyToken: token,
      expiresAt:   { $gt: new Date() },
    });

    if (!pending) {
      // Also check if already verified (user clicked link twice)
      const alreadyDone = await User.findOne({ email: pending?.email });
      if (alreadyDone?.emailVerified) return res.redirect("/login.html?verified=1");
      return res.status(400).send(emailResult("error", "Verification link is invalid or has expired. Please register again."));
    }

    // Check again that email not taken (race condition guard)
    const existingUser = await User.findOne({ email: pending.email });
    if (existingUser) {
      await PendingUser.deleteOne({ _id: pending._id });
      return res.redirect("/login.html?verified=1");
    }

    // ── Create the real User account now ──────────────────────
    const newUser = await User.create({
      name:         pending.name,
      email:        pending.email,
      password:     pending.password,   // already hashed
      phone:        pending.phone,
      role:         pending.role,
      skill:        pending.skill,
      location:     pending.location,
      bio:          pending.bio,
      idType:       pending.idType    || null,
      idDocument:   pending.idDocument || null,
      idStatus:     pending.idDocument ? "pending" : "none",
      emailVerified: true,             // verified right now
      verified:      false,            // admin verification (for workers)
      isActive:      true,
    });

    // Clean up pending record
    await PendingUser.deleteOne({ _id: pending._id });

    console.log("[VerifyEmail] Account created for:", newUser.email, "role:", newUser.role);

    // Redirect to login with success flag
    return res.redirect("/login.html?verified=1");
  } catch (err) {
    console.error(err);
    res.status(500).send(emailResult("error", "Server error. Please try again."));
  }
};

// ─── Resend Verification Email ────────────────────────────────
exports.resendVerification = async (req, res) => {
  try {
    // Look up by email from body (no auth token yet — account not created)
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email required" });

    const pending = await PendingUser.findOne({ email });
    if (!pending) {
      // May already be a verified user
      const user = await User.findOne({ email });
      if (user?.emailVerified) return res.json({ success: false, message: "Email already verified. Please log in." });
      return res.status(404).json({ success: false, message: "No pending registration found. Please register again." });
    }

    // Generate fresh token and extend expiry
    const verifyToken = crypto.randomBytes(32).toString("hex");
    pending.verifyToken = verifyToken;
    pending.expiresAt   = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pending.save();

    await mailer.sendVerificationEmail({ name: pending.name, email: pending.email, token: verifyToken });
    res.json({ success: true, message: "Verification email resent! Check your inbox." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to send email" });
  }
};

// ─── HTML result page helper ──────────────────────────────────
function emailResult(type, message) {
  const isOk = type === "ok";
  const color = isOk ? "#2E7D5E" : "#DC2626";
  const bg    = isOk ? "#E8F5EE" : "#FEF2F2";
  const icon  = isOk ? "✅" : "❌";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KaamConnect</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#FAF7F2;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}</style>
</head><body>
<div style="background:#fff;border-radius:20px;padding:48px 40px;max-width:460px;width:100%;text-align:center;box-shadow:0 16px 60px rgba(15,25,35,.08);border:1.5px solid rgba(15,25,35,.06)">
  <div style="font-size:48px;margin-bottom:16px">${icon}</div>
  <h1 style="font-family:Georgia,serif;font-size:24px;color:#1A3C34;margin-bottom:10px">${isOk ? "Email Verified!" : "Verification Failed"}</h1>
  <p style="font-size:14.5px;color:rgba(15,25,35,.6);margin-bottom:28px;line-height:1.6">${message}</p>
  <a href="/login.html" style="display:inline-block;padding:13px 32px;background:#E8601C;color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700">Go to Login →</a>
</div>
</body></html>`;
}