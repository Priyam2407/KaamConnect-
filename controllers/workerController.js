const { User, Job, Offer, Review, Notification } = require("../models");

// ─── Helper ─────────────────────────────────────────────────
function computeCommission(price) {
  const pct = parseFloat(process.env.COMMISSION_PERCENT || 10);
  return {
    commission:   parseFloat((price * pct / 100).toFixed(2)),
    workerAmount: parseFloat((price * (1 - pct / 100)).toFixed(2)),
  };
}
async function notify(userId, title, message, type, jobId = null) {
  try { await Notification.create({ userId, title, message, type, jobId, isRead: false }); }
  catch (e) { /* non-fatal */ }
}

// ─── GET /api/workers/find ───────────────────────────────────
exports.findWorkers = async (req, res) => {
  try {
    const { skill, location, min_rating } = req.query;
    const { show_offline } = req.query;
    const query = { role: "worker", isActive: true };
    // ✅ FIX: Only filter offline workers when explicitly requested (show_offline=0)
    // Default shows ALL workers — isAvailable:true would exclude seed/old workers
    // who have no isAvailable field set (undefined !== true)
    if (show_offline === "0") query.isAvailable = true;
    if (skill && skill !== "all") query.skill = skill.toLowerCase();
    if (location) query.location = { $regex: location, $options: "i" };
    if (min_rating) query.rating = { $gte: parseFloat(min_rating) };

    const workers = await User.find(query)
      .select("-password")
      .sort({ subscriptionStatus: -1, isAvailable: -1, verified: -1, rating: -1, totalJobs: -1 });

    res.json({ success: true, workers, count: workers.length });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ─── GET /api/workers/profile/:id ───────────────────────────
exports.getWorkerProfile = async (req, res) => {
  try {
    const worker = await User.findOne({ _id: req.params.id, role: "worker" }).select("-password");
    if (!worker) return res.status(404).json({ success: false, message: "Worker not found" });

    const reviews = await Review.find({ workerId: req.params.id })
      .populate("customerId", "name")
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({ success: true, worker, reviews });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ─── GET /api/workers/jobs ───────────────────────────────────
exports.getWorkerJobs = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = { workerId: req.user.id };
    if (status) query.status = status;

    const jobs = await Job.find(query)
      .populate("customerId", "name phone avatar")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Attach offer history per job
    const jobIds = jobs.map(j => j._id);
    const offers = await Offer.find({ jobId: { $in: jobIds } }).sort({ createdAt: 1 });
    const offerMap = {};
    for (const o of offers) {
      const key = o.jobId.toString();
      if (!offerMap[key]) offerMap[key] = [];
      offerMap[key].push(o);
    }

    const result = jobs.map(j => ({
      ...j.toObject(),
      offers: offerMap[j._id.toString()] || [],
    }));

    res.json({ success: true, jobs: result });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ─── POST /api/workers/set-price ────────────────────────────
// Worker sets their fixed base price shown on profile
exports.setBasePrice = async (req, res) => {
  try {
    const { basePrice, priceUnit, priceNote } = req.body;
    if (!basePrice || isNaN(parseFloat(basePrice)))
      return res.status(400).json({ success: false, message: "Valid price required" });

    await User.findByIdAndUpdate(req.user.id, {
      basePrice:  parseFloat(basePrice),
      priceUnit:  priceUnit || "job",
      priceNote:  priceNote || null,
    });

    res.json({ success: true, message: "Price updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── POST /api/workers/respond-offer ────────────────────────
// Worker sends their price offer OR accepts customer's budget
// action = "accept" | "counter" | "reject"
exports.respondToOffer = async (req, res) => {
  try {
    const { job_id, action, amount, note } = req.body;

    const job = await Job.findOne({ _id: job_id, workerId: req.user.id });
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (["completed","cancelled","paid"].includes(job.status))
      return res.status(400).json({ success: false, message: "Cannot negotiate at this stage" });

    // ── REJECT ────────────────────────────────────────────────
    if (action === "reject") {
      await Job.findByIdAndUpdate(job_id, { status: "cancelled", cancelledBy: "worker" });
      await Offer.updateMany({ jobId: job_id, status: "pending" }, { status: "rejected" });

      await notify(job.customerId, "Job Rejected ❌",
        "The worker couldn't take this job. Please book another worker.", "cancelled", job._id);

      return res.json({ success: true, message: "Job rejected" });
    }

    // ── ACCEPT customer's current budget ─────────────────────
    if (action === "accept") {
      const latestCustomerOffer = await Offer.findOne({
        jobId: job_id, fromRole: "customer", status: "pending"
      }).sort({ createdAt: -1 });

      const agreedPrice = latestCustomerOffer ? latestCustomerOffer.amount : job.customerBudget;
      const { commission, workerAmount } = computeCommission(agreedPrice);

      await Offer.updateMany({ jobId: job_id, status: "pending" }, { status: "accepted" });
      await Job.findByIdAndUpdate(job_id, {
        status:      "price_agreed",
        agreedPrice,
        price:       agreedPrice,
        commission,
        workerAmount,
      });

      await notify(job.customerId, "Worker Accepted Your Price! 🎉",
        `Worker accepted ₹${agreedPrice}. Work will begin soon!`, "price_agreed", job._id);

      return res.json({ success: true, message: `Accepted! Agreed price: ₹${agreedPrice}` });
    }

    // ── COUNTER with worker's price ───────────────────────────
    if (action === "counter") {
      const offerAmt = parseFloat(amount);
      if (isNaN(offerAmt) || offerAmt < 1)
        return res.status(400).json({ success: false, message: "Invalid amount" });

      // Mark previous pending offers countered
      await Offer.updateMany({ jobId: job_id, status: "pending" }, { status: "countered" });

      await Offer.create({
        jobId:      job_id,
        fromRole:   "worker",
        fromUserId: req.user.id,
        amount:     offerAmt,
        note:       note || null,
        status:     "pending",
      });

      await Job.findByIdAndUpdate(job_id, { status: "negotiating", price: offerAmt });

      await notify(job.customerId, "Worker Sent a Price 💬",
        `Worker quoted ₹${offerAmt} for your job. Accept or counter.`, "new_offer", job._id);

      return res.json({ success: true, message: `Counter offer of ₹${offerAmt} sent to customer` });
    }

    res.status(400).json({ success: false, message: "Invalid action. Use accept/counter/reject" });
  } catch (err) {
    console.error("respondToOffer:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── PUT /api/workers/job-status ────────────────────────────
// Update job status AFTER price is agreed
exports.updateJobStatus = async (req, res) => {
  try {
    const { job_id, status } = req.body;

    const validStatuses = ["accepted", "in_progress", "completed", "cancelled"];
    if (!validStatuses.includes(status))
      return res.status(400).json({ success: false, message: `Invalid status. Allowed: ${validStatuses.join(", ")}` });

    // Only allow status progression after price_agreed
    const job = await Job.findOne({ _id: job_id, workerId: req.user.id });
    if (!job) return res.status(404).json({ success: false, message: "Job not found or not authorized" });

    if (status !== "cancelled" && !["price_agreed","accepted","in_progress"].includes(job.status))
      return res.status(400).json({ success: false, message: "Price must be agreed before starting work" });

    const update = { status };
    if (status === "completed") update.completedAt = new Date();
    if (status === "cancelled") update.cancelledBy = "worker";

    await Job.findByIdAndUpdate(job_id, update);

    if (status === "completed") {
      await User.findByIdAndUpdate(req.user.id, { $inc: { totalJobs: 1 } });
    }

    const notifData = {
      accepted:    { title: "Job Accepted! 🎉",  msg: "Worker accepted and will start soon." },
      in_progress: { title: "Work Started! 🛠️",  msg: "Worker has started on your job." },
      completed:   { title: "Job Completed! ✅", msg: "Work is done! Please rate your experience." },
      cancelled:   { title: "Job Cancelled ❌",   msg: "Worker cancelled. Please book another." },
    };

    if (notifData[status] && job.customerId) {
      await notify(job.customerId, notifData[status].title, notifData[status].msg, status, job._id);
    }

    res.json({ success: true, message: `Job status updated to ${status}` });
  } catch (err) {
    console.error("updateJobStatus:", err);
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ─── GET /api/workers/earnings ───────────────────────────────
exports.getWorkerEarnings = async (req, res) => {
  try {
    const wId = req.user.id;
    const completedJobs = await Job.find({ workerId: wId, status: { $in: ["completed", "paid"] } });
    const now = new Date();
    const totalEarnings   = completedJobs.reduce((s, j) => s + (j.workerAmount || 0), 0);
    const monthlyEarnings = completedJobs
      .filter(j => j.createdAt.getMonth() === now.getMonth() && j.createdAt.getFullYear() === now.getFullYear())
      .reduce((s, j) => s + (j.workerAmount || 0), 0);

    const mongoose = require("mongoose");
    const jobStats = await Job.aggregate([
      { $match: { workerId: new mongoose.Types.ObjectId(wId.toString()) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    res.json({ success: true, totalEarnings, monthlyEarnings, jobStats });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ─── GET /api/workers/stats ──────────────────────────────────
exports.getWorkerStats = async (req, res) => {
  try {
    const wId = req.user.id;
    const [jobs, reviews, earnings] = await Promise.all([
      Job.find({ workerId: wId }),
      Review.find({ workerId: wId }),
      Job.find({ workerId: wId, status: { $in: ["completed", "paid"] } }),
    ]);

    const completed     = jobs.filter(j => ["completed","paid"].includes(j.status)).length;
    const pending       = jobs.filter(j => ["pending_offer","negotiating"].includes(j.status)).length;
    const accepted      = jobs.filter(j => ["price_agreed","accepted","in_progress"].includes(j.status)).length;
    const avgRating     = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
    const totalEarnings = earnings.reduce((s, j) => s + (j.workerAmount || 0), 0);

    res.json({
      success: true,
      stats: {
        total: jobs.length, completed, pending, accepted,
        avg_rating: avgRating.toFixed(1),
        total_reviews: reviews.length,
        total_earnings: totalEarnings,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching stats" });
  }
};