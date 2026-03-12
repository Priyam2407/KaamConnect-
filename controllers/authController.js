const { User } = require("../models");
const jwt = require("jsonwebtoken");

const signToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: "7d" });

exports.register = async (req, res) => {
  try {
    const { name, email, password, phone, role, skill, location, bio } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "Name, email and password required" });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(409).json({ success: false, message: "Email already registered" });

    const user = await User.create({ name, email, password, phone, role: role || "customer", skill: skill || undefined, location, bio });
    const token = signToken(user._id, user.role);

    res.json({
      success: true,
      message: "Registered successfully",
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, skill: user.skill, location: user.location },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: "Email and password required" });

    const user = await User.findOne({ email, isActive: true }).select("+password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ success: false, message: "Invalid password" });

    const token = signToken(user._id, user.role);
    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        skill: user.skill,
        location: user.location,
        avatar: user.avatar,
        verified: user.verified,
        rating: user.rating,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, location, bio, skill } = req.body;
    await User.findByIdAndUpdate(req.user.id, { name, phone, location, bio, skill });
    res.json({ success: true, message: "Profile updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Update failed" });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select("+password");
    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ success: false, message: "Current password is incorrect" });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Password update failed" });
  }
};
