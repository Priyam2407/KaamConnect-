const { User } = require("../models");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

// ─── JWT helper ─────────────────────────────────────────────
const signToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: "7d" });

// ─── Google OAuth Strategy ───────────────────────────────────
passport.use(
  new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  `${process.env.BASE_URL}/api/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Try to find existing Google user
        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          // Check if email already registered (link accounts)
          user = await User.findOne({ email: profile.emails[0].value });
          if (user) {
            // Link Google ID to existing account
            user.googleId = profile.id;
            if (!user.avatar) user.avatar = profile.photos[0]?.value;
            await user.save();
          } else {
            // Create brand new user via Google
            user = await User.create({
              name:     profile.displayName,
              email:    profile.emails[0].value,
              googleId: profile.id,
              avatar:   profile.photos[0]?.value || null,
              role:     "customer",
              password: "google_oauth_" + profile.id, // placeholder, never used for login
              verified: true,
            });
          }
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// ─── Register ────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, password, phone, role, skill, location, bio } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "Name, email and password required" });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(409).json({ success: false, message: "Email already registered" });

    const { idType, idDocument } = req.body;
    const isWorker = role === "worker";
    const userData = { name, email, password, phone, role: role || "customer", skill: skill || undefined, location, bio };
    if (isWorker && idType && idDocument) {
      userData.idType     = idType;
      userData.idDocument = idDocument;
      userData.idStatus   = "pending";
    }
    const user  = await User.create(userData);
    const token = signToken(user._id, user.role);

    res.json({
      success: true,
      message: "Registered successfully",
      token,
      user: {
        id: user._id, name: user.name, email: user.email,
        role: user.role, skill: user.skill, location: user.location,
        idStatus: user.idStatus || "none",
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Login ───────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password required" });

    const user = await User.findOne({ email, isActive: true }).select("+password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Block Google-only users from email login
    if (user.googleId && user.password && user.password.startsWith("google_oauth_")) {
      return res.status(401).json({ success: false, message: "This account uses Google Sign-In. Please continue with Google." });
    }

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ success: false, message: "Invalid password" });

    const token = signToken(user._id, user.role);
    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id, name: user.name, email: user.email, role: user.role,
        skill: user.skill, location: user.location, avatar: user.avatar,
        verified: user.verified, rating: user.rating,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── Google OAuth — initiate ─────────────────────────────────
exports.googleAuth = passport.authenticate("google", {
  scope: ["profile", "email"],
  session: false,
});

// ─── Google OAuth — callback ─────────────────────────────────
exports.googleCallback = (req, res) => {
  passport.authenticate("google", { session: false }, (err, user) => {
    if (err || !user) {
      console.error("Google OAuth error:", err);
      return res.redirect("/login.html?error=google_failed");
    }

    const token = signToken(user._id, user.role);
    const userData = encodeURIComponent(
      JSON.stringify({
        id:       user._id,
        name:     user.name,
        email:    user.email,
        role:     user.role,
        skill:    user.skill    || null,
        location: user.location || null,
        avatar:   user.avatar   || null,
      })
    );

    const dest = user.role === "admin"  ? "admin-dashboard.html"
               : user.role === "worker" ? "worker-dashboard.html"
               : "customer-dashboard.html";

    res.redirect(`/${dest}?token=${token}&user=${userData}`);
  })(req, res);
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

// ─── Update Profile ──────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, location, bio, skill } = req.body;
    await User.findByIdAndUpdate(req.user.id, { name, phone, location, bio, skill });
    res.json({ success: true, message: "Profile updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Update failed" });
  }
};

// ─── Change Password ─────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select("+password");

    if (user.googleId && user.password.startsWith("google_oauth_")) {
      return res.status(400).json({ success: false, message: "Google accounts cannot change password here." });
    }

    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ success: false, message: "Current password is incorrect" });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Password update failed" });
  }
};