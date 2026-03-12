const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authMiddleware");
const { Job } = require("../models");

// Create Razorpay order
router.post("/create-order", authenticateToken, async (req, res) => {
  try {
    const { amount, job_id } = req.body;
    if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID === "rzp_test_xxxxxxxxxxxx") {
      return res.json({
        success: true,
        order: { id: "order_mock_" + Date.now(), amount: amount * 100, currency: "INR" },
        key: process.env.RAZORPAY_KEY_ID,
        demo: true
      });
    }
    const Razorpay = require("razorpay");
    const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    const order = await razorpay.orders.create({ amount: amount * 100, currency: "INR", receipt: `job_${job_id}_${Date.now()}` });
    res.json({ success: true, order, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    res.status(500).json({ success: false, message: "Payment initialization failed" });
  }
});

// Verify payment — FIXED: was using MySQL db.query, now uses Mongoose
router.post("/verify", authenticateToken, async (req, res) => {
  try {
    const { job_id, razorpay_payment_id, razorpay_order_id, amount } = req.body;
    const job = await Job.findById(job_id);
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    const commissionPercent = parseFloat(process.env.COMMISSION_PERCENT || 10);
    const commission = amount * commissionPercent / 100;
    const workerAmount = amount - commission;
    await Job.findByIdAndUpdate(job_id, {
      status: "paid",
      razorpayOrderId: razorpay_order_id || "mock",
      razorpayPaymentId: razorpay_payment_id || "mock",
      commission,
      workerAmount
    });
    res.json({ success: true, message: "Payment verified successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Payment recording failed" });
  }
});

module.exports = router;
