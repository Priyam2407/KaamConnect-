const { User, PendingUser } = require("../models");
const jwt      = require("jsonwebtoken");
const passport = require("passport");
const crypto   = require("crypto");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const mailer   = require("../config/mailer");

// ─── JWT helper ──────────────────────────────────────────────
const signToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: "7d" });

// ─── Referral code generator ─────────────────────────────────
function genRefCode(name) {
  const base = (name || "USER").replace(/\s+/g, "").toUpperCase().slice(0, 5);
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return base + rand;
}

// ─── Google OAuth Strategy ────────────────────────────────────
passport.use(
  new GoogleStrategy(
    {
      clientID:          process.env.GOOGLE_CLIENT_ID,
      clientSecret:      process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:       `${process.env.BASE_URL}/api/auth/google/callback`,
      passReqToCallback: true,
      // ✅ FIX 1: Disable state/session — we don't use express-session
      // Without this, passport-oauth2 throws:
      // "OAuth 2.0 authentication requires session support when using state"
      state: false,
      store: false,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        // ✅ FIX 2: Guard against missing email (some Google accounts)
        if (!profile.emails || !profile.emails[0] || !profile.emails[0].value) {
          return done(null, false, { message: "Google account has no email address" });
        }

        const email  = profile.emails[0].value.toLowerCase().trim();
        const avatar = profile.photos?.[0]?.value || null;

        // 1. Already has this Google account → log in directly
        let user = await User.findOne({ googleId: profile.id });
        if (user) {
          // ✅ FIX 3: Check if deactivated
          if (!user.isActive) return done(null, false, { message: "Account is deactivated" });
          return done(null, { user, isNew: false });
        }

        // 2. Email already registered with password → link Google to it
        user = await User.findOne({ email });
        if (user) {
          if (!user.isActive) return done(null, false, { message: "Account is deactivated" });
          user.googleId = profile.id;
          if (!user.avatar) user.avatar = avatar;
          // ✅ Don't call user.save() if nothing changed to avoid pre-save hash issues
          await User.findByIdAndUpdate(user._id, {
            googleId: profile.id,
            ...((!user.avatar && avatar) ? { avatar } : {}),
          });
          const updatedUser = await User.findById(user._id);
          return done(null, { user: updatedUser, isNew: false });
        }

        // 3. Brand new Google user — generate unique referral code
        let referralCode, exists = true;
        while (exists) {
          referralCode = genRefCode(profile.displayName);
          exists = await User.findOne({ referralCode });
        }

        // ✅ FIX 4: Use findOneAndUpdate with upsert to handle race conditions
        // Also: do NOT set password field — let model default handle it
        // This avoids the pre-save hook trying to hash a placeholder
        user = await User.create({
          name:          profile.displayName,
          email,
          googleId:      profile.id,
          avatar,
          role:          "customer",
          // ✅ FIX 5: Set password to null (not "google_oauth_...") so pre-save hook skips it cleanly
          password:      null,
          verified:      true,
          emailVerified: true,   // Google already verified their email
          isActive:      true,
          referralCode,
        });

        return done(null, { user, isNew: true });
      } catch (err) {
        // ✅ FIX 6: Handle MongoDB duplicate key (race condition) gracefully
        if (err.code === 11000) {
          try {
            // Another request created the user simultaneously — find and return them
            const email = profile.emails?.[0]?.value?.toLowerCase()?.trim();
            const existing = await User.findOne({
              $or: [
                { googleId: profile.id },
                { email },
              ],
            });
            if (existing) {
              if (!existing.googleId) {
                await User.findByIdAndUpdate(existing._id, { googleId: profile.id });
              }
              const user = await User.findById(existing._id);
              return done(null, { user, isNew: false });
            }
          } catch (innerErr) {
            return done(innerErr, null);
          }
        }
        console.error("[Google OAuth Strategy Error]", err.message);
        return done(err, null);
      }
    }
  )
);

// ─── Register ─────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const {
      name, email, password, phone, role,
      skill, location, bio, idType, idDocument, referralCode: usedRefCode
    } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "Name, email and password required" });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(409).json({ success: false, message: "Email already registered" });

    await PendingUser.deleteOne({ email });

    const bcrypt       = require("bcryptjs");
    const hashedPassword = await bcrypt.hash(password, 10);
    const verifyToken  = crypto.randomBytes(32).toString("hex");
    const expiresAt    = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await PendingUser.create({
      name, email,
      password:     hashedPassword,
      phone:        phone      || undefined,
      role:         role       || "customer",
      skill:        skill      || undefined,
      location:     location   || undefined,
      bio:          bio        || undefined,
      idType:       idType     || undefined,
      idDocument:   idDocument || undefined,
      referralCode: usedRefCode || null,
      verifyToken,
      expiresAt,
    });

    let emailSent = false, emailError = null;
    try {
      await mailer.sendVerificationEmail({ name, email, token: verifyToken });
      emailSent = true;
    } catch (emailErr) {
      emailError = emailErr.message;
      console.error("[Register] ⚠️ Email failed:", emailErr.message);
    }

    res.json({
      success:    true,
      pending:    true,
      emailSent,
      emailError: emailError ? "Email delivery failed — please use the Resend button." : null,
      message:    emailSent
        ? "Verification email sent! Check your inbox and click the link."
        : "Details saved. Email failed — click Resend below.",
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

    // ✅ FIX 7: Null password means Google-only account
    if (!user.password || (user.googleId && user.password === null))
      return res.status(401).json({ success: false, message: "This account uses Google Sign-In. Please click 'Continue with Google'." });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ success: false, message: "Invalid password" });

    if (!user.googleId && user.role !== "admin" && user.emailVerified === false) {
      const token = signToken(user._id, user.role);
      return res.status(403).json({
        success:         false,
        emailUnverified: true,
        message:         "Please verify your email before logging in.",
        token,
        email:           user.email,
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

// ─── Google Auth — Step 1 ─────────────────────────────────────
// ✅ FIX 8: Pass state:false to prevent session/state CSRF check
exports.googleAuth = passport.authenticate("google", {
  scope:   ["profile", "email"],
  session: false,
  state:   false,   // ← disables the session-based state store
});

// ─── Google Auth — Step 2: callback ──────────────────────────
exports.googleCallback = (req, res) => {
  passport.authenticate("google", { session: false, state: false }, (err, result, info) => {
    if (err) {
      console.error("[Google OAuth Callback Error]:", err.message);
      return res.redirect("/login.html?error=google_failed");
    }

    if (!result) {
      const reason = info?.message || "google_failed";
      console.error("[Google OAuth] No result:", reason);
      return res.redirect(`/login.html?error=google_failed&reason=${encodeURIComponent(reason)}`);
    }

    const { user, isNew } = result;
    const token    = signToken(user._id, user.role);
    const userData = encodeURIComponent(JSON.stringify({
      id:       user._id,
      name:     user.name,
      email:    user.email,
      role:     user.role,
      skill:    user.skill    || null,
      location: user.location || null,
    }));

    if (isNew) {
      return res.redirect(`/google-role.html?token=${token}&user=${userData}`);
    }

    const dest = user.role === "admin"  ? "admin-dashboard.html"
               : user.role === "worker" ? "worker-dashboard.html"
               : "customer-dashboard.html";

    res.redirect(`/${dest}?token=${token}&user=${userData}`);
  })(req, res);
};

// ─── Update Google role ───────────────────────────────────────
exports.updateGoogleRole = async (req, res) => {
  try {
    const { role, skill, location, phone, bio, idType, idDocument, password } = req.body;

    if (!["customer", "worker"].includes(role))
      return res.status(400).json({ success: false, message: "Invalid role" });

    if (password && password.length < 6)
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });

    const updateData = { role };
    if (phone)    updateData.phone    = phone;
    if (location) updateData.location = location;
    if (role === "worker") {
      if (skill)      updateData.skill      = skill;
      if (bio)        updateData.bio        = bio;
      if (idType)     updateData.idType     = idType;
      if (idDocument) { updateData.idDocument = idDocument; updateData.idStatus = "pending"; }
    }

    if (password) {
      // ✅ Set password directly — pre-save hook will hash it
      updateData.password = password;
    }

    // ✅ Use save() only for password (triggers pre-save hook), findByIdAndUpdate for rest
    if (password) {
      const user = await User.findById(req.user.id);
      user.password = password;
      Object.assign(user, updateData);
      await user.save();
    } else {
      await User.findByIdAndUpdate(req.user.id, updateData);
    }

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

    // ✅ Google-only user (null password)
    if (!user.password)
      return res.status(400).json({ success: false, message: "Google accounts don't have a password. Set one below." });

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

    const pending = await PendingUser.findOne({
      verifyToken: token,
      expiresAt:   { $gt: new Date() },
    });

    if (!pending) {
      return res.status(400).send(emailResult("error", "Verification link is invalid or has expired. Please register again."));
    }

    const existingUser = await User.findOne({ email: pending.email });
    if (existingUser) {
      await PendingUser.deleteOne({ _id: pending._id });
      return res.redirect("/login.html?verified=1");
    }

    // Generate referral code for new user
    let referralCode, exists = true;
    while (exists) {
      referralCode = genRefCode(pending.name);
      exists = await User.findOne({ referralCode });
    }

    const newUser = await User.create({
      name:          pending.name,
      email:         pending.email,
      password:      pending.password,
      phone:         pending.phone,
      role:          pending.role,
      skill:         pending.skill,
      location:      pending.location,
      bio:           pending.bio,
      idType:        pending.idType     || null,
      idDocument:    pending.idDocument || null,
      idStatus:      pending.idDocument ? "pending" : "none",
      emailVerified: true,
      verified:      false,
      isActive:      true,
      referralCode,
    });

    // Apply referral if the pending user used a code
    if (pending.referralCode) {
      try {
        const { applyReferral } = require("./referralController");
        await applyReferral(newUser._id, pending.referralCode);
      } catch (e) { /* non-fatal */ }
    }

    await PendingUser.deleteOne({ _id: pending._id });
    console.log("[VerifyEmail] Account created:", newUser.email, "role:", newUser.role);

    return res.redirect("/login.html?verified=1");
  } catch (err) {
    console.error(err);
    res.status(500).send(emailResult("error", "Server error. Please try again."));
  }
};

// ─── Resend Verification Email ────────────────────────────────
exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email required" });

    const pending = await PendingUser.findOne({ email });
    if (!pending) {
      const user = await User.findOne({ email });
      if (user?.emailVerified) return res.json({ success: false, message: "Email already verified. Please log in." });
      return res.status(404).json({ success: false, message: "No pending registration found. Please register again." });
    }

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
  const icon = isOk ? "✅" : "❌";
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