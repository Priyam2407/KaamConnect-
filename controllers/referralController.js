const { User, Referral, Notification } = require("../models");
const crypto = require("crypto");

// Generate a unique referral code for user
function generateCode(name) {
  const base = name.replace(/\s+/g, "").toUpperCase().slice(0, 5);
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${base}${rand}`;
}

// ─── GET /api/referral/my-code ──────────────────────────────
// Get or create referral code for logged-in user
exports.getMyCode = async (req, res) => {
  try {
    let user = await User.findById(req.user.id).select("name referralCode referralCredits totalReferrals");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (!user.referralCode) {
      let code, exists = true;
      while (exists) {
        code  = generateCode(user.name);
        exists = await User.findOne({ referralCode: code });
      }
      user.referralCode = code;
      await user.save();
    }

    const referrals = await Referral.find({ referrerId: req.user.id })
      .populate("refereeId", "name createdAt role")
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      referralCode:    user.referralCode,
      referralCredits: user.referralCredits || 0,
      totalReferrals:  user.totalReferrals  || 0,
      referralLink:    `${process.env.BASE_URL}/register.html?ref=${user.referralCode}`,
      perReferral:     50, // ₹ per successful referral
      referrals,
    });
  } catch (err) {
    console.error("getMyCode:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── POST /api/referral/apply ───────────────────────────────
// Apply referral code when user registers (called from authController on email verify)
exports.applyReferral = async (refereeId, referralCode) => {
  try {
    if (!referralCode) return;
    const referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
    if (!referrer) return;
    if (referrer._id.toString() === refereeId.toString()) return; // self-referral guard

    // Check if already referred
    const existing = await Referral.findOne({ refereeId });
    if (existing) return;

    // Credit ₹50 to referrer
    await Referral.create({
      referrerId: referrer._id,
      refereeId,
      referralCode,
      creditsEarned: 50,
      status: "credited",
    });

    await User.findByIdAndUpdate(referrer._id, {
      $inc: { referralCredits: 50, totalReferrals: 1 },
    });

    await Notification.create({
      userId:  referrer._id,
      title:   "Referral Bonus! 🎉",
      message: "Someone joined using your referral code. ₹50 added to your wallet!",
      type:    "referral_credited",
    });
  } catch (err) {
    console.error("applyReferral:", err.message); // non-fatal
  }
};

// ─── POST /api/referral/redeem ──────────────────────────────
// Redeem referral credits against a job (deduct from credits)
exports.redeemCredits = async (req, res) => {
  try {
    const { amount } = req.body;
    const redeemAmt = parseFloat(amount);
    const user = await User.findById(req.user.id).select("referralCredits");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.referralCredits < redeemAmt)
      return res.status(400).json({ success: false, message: `You only have ₹${user.referralCredits} in credits` });

    await User.findByIdAndUpdate(req.user.id, { $inc: { referralCredits: -redeemAmt } });
    res.json({ success: true, message: `₹${redeemAmt} credits redeemed`, remaining: user.referralCredits - redeemAmt });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
