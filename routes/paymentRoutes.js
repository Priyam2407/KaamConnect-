const express = require("express");
const router  = express.Router();
const crypto  = require("crypto");
const { authenticateToken } = require("../middleware/authMiddleware");
const { Job, Notification, User } = require("../models");

// ─── Helper: notify ──────────────────────────────────────────
async function notify(userId, title, message, type, jobId = null) {
  try { await Notification.create({ userId, title, message, type, jobId, isRead: false }); } catch (e) {}
}

// ─── Helper: get Razorpay instance ───────────────────────────
function getRazorpay() {
  const keyId     = process.env.RAZORPAY_KEY_ID     || "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  if (!keyId || !keySecret) return null;
  const Razorpay = require("razorpay");
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

// ─── POST /api/payment/create-order ──────────────────────────
router.post("/create-order", authenticateToken, async (req, res) => {
  try {
    const { amount, job_id } = req.body;
    if (!amount || !job_id)
      return res.status(400).json({ success: false, message: "Amount and job_id required" });

    const job = await Job.findOne({ _id: job_id, customerId: req.user.id });
    if (!job)
      return res.status(404).json({ success: false, message: "Job not found" });
    if (!["completed", "price_agreed", "in_progress"].includes(job.status))
      return res.status(400).json({ success: false, message: "Job not eligible for payment" });

    const razorpay = getRazorpay();
    if (!razorpay)
      return res.status(500).json({ success: false, message: "Payment gateway not configured. Please contact support." });

    const order = await razorpay.orders.create({
      amount:   Math.round(parseFloat(amount) * 100), // paise
      currency: "INR",
      receipt:  `job_${job_id}_${Date.now()}`,
      notes:    { job_id: job_id.toString(), customer_id: req.user.id.toString() },
    });

    res.json({ success: true, order, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error("create-order error:", err);
    // Return actual Razorpay error description to the client
    const msg = err?.error?.description || err?.message || "Payment initialization failed";
    res.status(500).json({ success: false, message: msg });
  }
});

// ─── POST /api/payment/verify ─────────────────────────────────
router.post("/verify", authenticateToken, async (req, res) => {
  try {
    const { job_id, razorpay_payment_id, razorpay_order_id, razorpay_signature, amount, payment_method } = req.body;

    const job = await Job.findById(job_id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    // Signature verification
    const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
    if (razorpay_signature && keySecret) {
      const body     = razorpay_order_id + "|" + razorpay_payment_id;
      const expected = crypto.createHmac("sha256", keySecret).update(body).digest("hex");
      if (expected !== razorpay_signature)
        return res.status(400).json({ success: false, message: "Payment signature invalid" });
    }

    const paidAmt    = parseFloat(amount) || job.agreedPrice || job.price || 0;
    const pct        = parseFloat(process.env.COMMISSION_PERCENT || 10);
    const commission = parseFloat((paidAmt * pct / 100).toFixed(2));
    const workerAmt  = parseFloat((paidAmt - commission).toFixed(2));

    await Job.findByIdAndUpdate(job_id, {
      status:            "paid",
      razorpayOrderId:   razorpay_order_id   || "",
      razorpayPaymentId: razorpay_payment_id || "",
      paymentMethod:     payment_method || "razorpay",
      commission,
      workerAmount: workerAmt,
    });

    await notify(job.workerId, "Payment Received 💰",
      `Customer paid ₹${paidAmt} via ${payment_method || "Razorpay"}. Your earnings: ₹${workerAmt}`,
      "payment", job_id);

    res.json({ success: true, message: "Payment verified successfully", workerAmount: workerAmt });
  } catch (err) {
    console.error("verify error:", err);
    res.status(500).json({ success: false, message: "Payment recording failed" });
  }
});

// ─── POST /api/payment/cod ────────────────────────────────────
router.post("/cod", authenticateToken, async (req, res) => {
  try {
    const { job_id } = req.body;
    if (!job_id) return res.status(400).json({ success: false, message: "job_id required" });

    const job = await Job.findOne({ _id: job_id, customerId: req.user.id });
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    if (!["completed", "price_agreed", "in_progress"].includes(job.status))
      return res.status(400).json({ success: false, message: "Job not eligible for COD payment" });

    const paidAmt    = job.agreedPrice || job.price || 0;
    const pct        = parseFloat(process.env.COMMISSION_PERCENT || 10);
    const commission = parseFloat((paidAmt * pct / 100).toFixed(2));
    const workerAmt  = parseFloat((paidAmt - commission).toFixed(2));

    await Job.findByIdAndUpdate(job_id, {
      status:         "paid",
      paymentMethod:  "cod",
      codConfirmedAt: new Date(),
      commission,
      workerAmount: workerAmt,
    });

    await notify(job.workerId, "Cash Payment Confirmed 💵",
      `Customer confirmed cash payment of ₹${paidAmt}. Please collect ₹${workerAmt} (after platform fee).`,
      "payment", job_id);

    res.json({ success: true, message: "Cash payment confirmed! Worker has been notified.", workerAmount: workerAmt });
  } catch (err) {
    console.error("cod error:", err);
    res.status(500).json({ success: false, message: "COD confirmation failed" });
  }
});

// ─── POST /api/payment/worker-cod-confirm ─────────────────────
router.post("/worker-cod-confirm", authenticateToken, async (req, res) => {
  try {
    const { job_id } = req.body;
    const job = await Job.findOne({ _id: job_id, workerId: req.user.id, paymentMethod: "cod" });
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    await notify(job.customerId, "Worker Confirmed Cash Receipt 🤝",
      `Worker confirmed receiving cash for job: ${job.title || job.skill}`,
      "payment", job_id);

    res.json({ success: true, message: "Cash receipt confirmed" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ─── POST /api/payment/subscription-order ─────────────────────
router.post("/subscription-order", authenticateToken, async (req, res) => {
  try {
    const { plan, use_credits } = req.body;
    const PLANS = {
      basic:   { price: 299, name: "Basic",   days: 30 },
      premium: { price: 599, name: "Premium", days: 30 },
    };
    if (!PLANS[plan]) return res.status(400).json({ success: false, message: "Invalid plan" });

    const user = await User.findById(req.user.id).select("referralCredits");
    let price = PLANS[plan].price;
    let creditsUsed = 0;
    if (use_credits && user.referralCredits > 0) {
      creditsUsed = Math.min(user.referralCredits, Math.floor(price * 0.5));
      price -= creditsUsed;
    }
    if (price <= 0)
      return res.json({ success: true, free: true, plan, creditsUsed, price: 0 });

    const razorpay = getRazorpay();
    if (!razorpay)
      return res.status(500).json({ success: false, message: "Payment gateway not configured." });

    const order = await razorpay.orders.create({
      amount:   price * 100,
      currency: "INR",
      receipt:  `sub_${plan}_${req.user.id}_${Date.now()}`,
      notes:    { plan, user_id: req.user.id.toString(), credits_used: creditsUsed.toString() },
    });

    res.json({ success: true, order, key: process.env.RAZORPAY_KEY_ID, plan, price, creditsUsed });
  } catch (err) {
    console.error("subscription-order error:", err);
    const msg = err?.error?.description || err?.message || "Failed to create subscription order";
    res.status(500).json({ success: false, message: msg });
  }
});

// ─── POST /api/payment/subscription-verify ────────────────────
router.post("/subscription-verify", authenticateToken, async (req, res) => {
  try {
    const { plan, razorpay_payment_id, razorpay_order_id, razorpay_signature, price, credits_used } = req.body;
    const PLANS = {
      basic:   { price: 299, name: "Basic",   days: 30 },
      premium: { price: 599, name: "Premium", days: 30 },
    };
    if (!PLANS[plan]) return res.status(400).json({ success: false, message: "Invalid plan" });

    const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
    if (razorpay_signature && keySecret) {
      const body     = razorpay_order_id + "|" + razorpay_payment_id;
      const expected = crypto.createHmac("sha256", keySecret).update(body).digest("hex");
      if (expected !== razorpay_signature)
        return res.status(400).json({ success: false, message: "Subscription payment signature invalid" });
    }

    const user = await User.findById(req.user.id).select("subscriptionStatus subscriptionExpires referralCredits");
    const creditsUsed = parseInt(credits_used || 0, 10);
    const now  = new Date();
    const base = (user.subscriptionExpires && user.subscriptionExpires > now) ? user.subscriptionExpires : now;
    const expiresAt = new Date(base.getTime() + PLANS[plan].days * 24 * 60 * 60 * 1000);

    const update = {
      subscriptionStatus:  plan,
      subscriptionExpires: expiresAt,
      subscriptionTxnId:   razorpay_payment_id || `manual_${Date.now()}`,
    };
    if (creditsUsed > 0) update.$inc = { referralCredits: -creditsUsed };
    await User.findByIdAndUpdate(req.user.id, update);

    await Notification.create({
      userId:  req.user.id,
      title:   `${PLANS[plan].name} Plan Activated! 🚀`,
      message: `Your ${PLANS[plan].name} subscription is active until ${expiresAt.toLocaleDateString("en-IN")}.${creditsUsed > 0 ? ` ₹${creditsUsed} credits used.` : ""}`,
      type:    "subscription_activated",
    });

    res.json({ success: true, message: `${PLANS[plan].name} plan activated!`, plan, expiresAt, creditsUsed, pricePaid: price });
  } catch (err) {
    console.error("subscription-verify error:", err);
    res.status(500).json({ success: false, message: "Failed to activate plan" });
  }
});

module.exports = router;