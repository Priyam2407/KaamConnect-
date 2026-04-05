const { User, Notification } = require("../models");

const PLANS = {
  basic:   { price: 299, name: "Basic",   days: 30, features: ["Priority listing", "20 bids/mo", "Badge"] },
  premium: { price: 599, name: "Premium", days: 30, features: ["Top listing", "Unlimited bids", "Gold badge", "Analytics"] },
};

// ─── GET /api/subscription/plans ────────────────────────────
exports.getPlans = (req, res) => {
  res.json({ success: true, plans: PLANS, currency: "INR" });
};

// ─── GET /api/subscription/status ───────────────────────────
exports.getStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("subscriptionStatus subscriptionExpires referralCredits role name");
    const now = new Date();
    const isActive = user.subscriptionStatus !== "free" &&
                     user.subscriptionExpires && user.subscriptionExpires > now;
    const daysLeft = isActive
      ? Math.ceil((user.subscriptionExpires - now) / (1000 * 60 * 60 * 24))
      : 0;

    res.json({
      success: true,
      plan:           isActive ? user.subscriptionStatus : "free",
      isActive,
      daysLeft,
      expiresAt:      user.subscriptionExpires || null,
      credits:        user.referralCredits || 0,
      planDetails:    PLANS[user.subscriptionStatus] || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── POST /api/subscription/activate ────────────────────────
// Called after successful Razorpay payment for subscription
exports.activatePlan = async (req, res) => {
  try {
    const { plan, payment_id, use_credits } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ success: false, message: "Invalid plan" });

    const user = await User.findById(req.user.id).select("subscriptionStatus subscriptionExpires referralCredits");
    let price = PLANS[plan].price;

    // Apply referral credits (max 50% discount)
    let creditsUsed = 0;
    if (use_credits && user.referralCredits > 0) {
      creditsUsed = Math.min(user.referralCredits, Math.floor(price * 0.5));
      price -= creditsUsed;
    }

    const now  = new Date();
    const base = (user.subscriptionExpires && user.subscriptionExpires > now)
      ? user.subscriptionExpires  // extend existing
      : now;
    const expiresAt = new Date(base.getTime() + PLANS[plan].days * 24 * 60 * 60 * 1000);

    const update = {
      subscriptionStatus:  plan,
      subscriptionExpires: expiresAt,
      subscriptionTxnId:   payment_id || `manual_${Date.now()}`,
    };
    if (creditsUsed > 0) update.$inc = { referralCredits: -creditsUsed };

    await User.findByIdAndUpdate(req.user.id, update);

    await Notification.create({
      userId:  req.user.id,
      title:   `${PLANS[plan].name} Plan Activated! 🚀`,
      message: `Your ${PLANS[plan].name} subscription is active until ${expiresAt.toLocaleDateString("en-IN")}. ${creditsUsed > 0 ? `₹${creditsUsed} credits used.` : ""}`,
      type:    "subscription_activated",
    });

    res.json({
      success: true,
      message: `${PLANS[plan].name} plan activated!`,
      plan,
      expiresAt,
      creditsUsed,
      pricePaid: price,
    });
  } catch (err) {
    console.error("activatePlan:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
