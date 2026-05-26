const express = require("express");
const router  = express.Router();
const crypto  = require("crypto");
const { authenticateToken } = require("../middleware/authMiddleware");
const { Job, Notification } = require("../models");

// ─── Helper: notify ──────────────────────────────────────────
async function notify(userId, title, message, type, jobId = null) {
  try { await Notification.create({ userId, title, message, type, jobId, isRead: false }); } catch (e) {}
}

// ─── POST /api/payments/create-order (Razorpay) ──────────────
router.post("/create-order", authenticateToken, async (req, res) => {
  try {
    const { amount, job_id } = req.body;
    if (!amount || !job_id)
      return res.status(400).json({ success: false, message: "Amount and job_id required" });

    const job = await Job.findOne({ _id: job_id, customerId: req.user.id });
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    if (!["completed","price_agreed","in_progress"].includes(job.status))
      return res.status(400).json({ success: false, message: "Job not eligible for payment" });

    // Demo / test key fallback
    if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.includes("xxxx")) {
      return res.json({
        success: true,
        order:   { id: "order_mock_" + Date.now(), amount: amount * 100, currency: "INR" },
        key:     process.env.RAZORPAY_KEY_ID || "rzp_test_demo",
        demo:    true,
      });
    }

    const Razorpay = require("razorpay");
    const razorpay = new Razorpay({
      key_id:     process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    const order = await razorpay.orders.create({
      amount:   Math.round(amount * 100),
      currency: "INR",
      receipt:  `job_${job_id}_${Date.now()}`,
    });
    res.json({ success: true, order, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error("create-order:", err);
    res.status(500).json({ success: false, message: "Payment initialization failed" });
  }
});

// ─── POST /api/payments/verify (Razorpay callback) ───────────
router.post("/verify", authenticateToken, async (req, res) => {
  try {
    const { job_id, razorpay_payment_id, razorpay_order_id, razorpay_signature, amount, payment_method } = req.body;

    const job = await Job.findById(job_id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    // Signature verification (skip in demo mode)
    if (razorpay_signature && process.env.RAZORPAY_KEY_SECRET && !process.env.RAZORPAY_KEY_SECRET.includes("xxxx")) {
      const body      = razorpay_order_id + "|" + razorpay_payment_id;
      const expected  = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(body).digest("hex");
      if (expected !== razorpay_signature)
        return res.status(400).json({ success: false, message: "Payment signature invalid" });
    }

    const paidAmt    = parseFloat(amount) || job.agreedPrice || job.price || 0;
    const pct        = parseFloat(process.env.COMMISSION_PERCENT || 10);
    const commission = parseFloat((paidAmt * pct / 100).toFixed(2));
    const workerAmt  = parseFloat((paidAmt - commission).toFixed(2));

    await Job.findByIdAndUpdate(job_id, {
      status:            "paid",
      razorpayOrderId:   razorpay_order_id   || "mock",
      razorpayPaymentId: razorpay_payment_id || "mock",
      paymentMethod:     payment_method || "razorpay",
      commission,
      workerAmount: workerAmt,
    });

    await notify(job.workerId, "Payment Received 💰",
      `Customer paid ₹${paidAmt} via ${payment_method || "Razorpay"}. Your earnings: ₹${workerAmt}`,
      "payment", job_id);

    res.json({ success: true, message: "Payment verified successfully", workerAmount: workerAmt });
  } catch (err) {
    console.error("verify:", err);
    res.status(500).json({ success: false, message: "Payment recording failed" });
  }
});

// ─── POST /api/payments/cod ───────────────────────────────────
// Customer marks job as paid via Cash on Delivery
router.post("/cod", authenticateToken, async (req, res) => {
  try {
    const { job_id } = req.body;
    if (!job_id) return res.status(400).json({ success: false, message: "job_id required" });

    const job = await Job.findOne({ _id: job_id, customerId: req.user.id });
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    if (!["completed","price_agreed","in_progress"].includes(job.status))
      return res.status(400).json({ success: false, message: "Job not eligible for COD payment" });

    const paidAmt    = job.agreedPrice || job.price || 0;
    const pct        = parseFloat(process.env.COMMISSION_PERCENT || 10);
    const commission = parseFloat((paidAmt * pct / 100).toFixed(2));
    const workerAmt  = parseFloat((paidAmt - commission).toFixed(2));

    await Job.findByIdAndUpdate(job_id, {
      status:        "paid",
      paymentMethod: "cod",
      codConfirmedAt: new Date(),
      commission,
      workerAmount: workerAmt,
    });

    await notify(job.workerId, "Cash Payment Confirmed 💵",
      `Customer confirmed cash payment of ₹${paidAmt}. Please collect ₹${workerAmt} (after platform fee).`,
      "payment", job_id);

    res.json({ success: true, message: "Cash payment confirmed! Worker has been notified.", workerAmount: workerAmt });
  } catch (err) {
    console.error("cod:", err);
    res.status(500).json({ success: false, message: "COD confirmation failed" });
  }
});

// ─── POST /api/payments/worker-cod-confirm ────────────────────
// Worker confirms they received cash
router.post("/worker-cod-confirm", authenticateToken, async (req, res) => {
  try {
    const { job_id } = req.body;
    const job = await Job.findOne({ _id: job_id, workerId: req.user.id, paymentMethod: "cod" });
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    // Already handled by COD endpoint; this is just worker acknowledgement
    await notify(job.customerId, "Worker Confirmed Cash Receipt 🤝",
      `Worker confirmed receiving cash for job: ${job.title || job.skill}`,
      "payment", job_id);

    res.json({ success: true, message: "Cash receipt confirmed" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;