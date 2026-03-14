const { User, Job, Review, Notification } = require("../models");

exports.findWorkers = async (req, res) => {
  try {
    const { skill, location, min_rating } = req.query;
    const query = { role: "worker", isActive: true };
    if (skill && skill !== "all") query.skill = skill.toLowerCase();
    if (location) query.location = { $regex: location, $options: "i" };
    if (min_rating) query.rating = { $gte: parseFloat(min_rating) };

    const workers = await User.find(query)
      .select("-password")
      .sort({ verified: -1, rating: -1, totalJobs: -1 });

    res.json({ success: true, workers, count: workers.length });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

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

exports.getWorkerJobs = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = { workerId: req.user.id };
    if (status) query.status = status;

    const jobs = await Job.find(query)
      .populate("customerId", "name phone")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

exports.getWorkerEarnings = async (req, res) => {
  try {
    const wId = req.user.id;
    const completedJobs = await Job.find({ workerId: wId, status: { $in: ["completed", "paid"] } });
    const now = new Date();

    const totalEarnings = completedJobs.reduce((sum, j) => sum + (j.workerAmount || 0), 0);
    const monthlyEarnings = completedJobs
      .filter(j => j.createdAt.getMonth() === now.getMonth() && j.createdAt.getFullYear() === now.getFullYear())
      .reduce((sum, j) => sum + (j.workerAmount || 0), 0);

    const jobStats = await Job.aggregate([
      { $match: { workerId: require("mongoose").Types.ObjectId.createFromHexString ? require("mongoose").Types.ObjectId.createFromHexString(wId.toString()) : wId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    res.json({ success: true, totalEarnings, monthlyEarnings, jobStats });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ─── FIXED: Added "cancelled" to allow worker to reject jobs ───────────────
exports.updateJobStatus = async (req, res) => {
  try {
    const { job_id, status } = req.body;

    // "cancelled" = worker rejected the job
    const validStatuses = ["accepted", "in_progress", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${validStatuses.join(", ")}`,
      });
    }

    const update = { status };
    if (status === "completed") update.completedAt = new Date();

    const job = await Job.findOneAndUpdate(
      { _id: job_id, workerId: req.user.id },
      update,
      { new: true }
    );

    if (!job) return res.status(404).json({ success: false, message: "Job not found or not authorized" });

    // Increment worker's totalJobs on completion
    if (status === "completed") {
      await User.findByIdAndUpdate(req.user.id, { $inc: { totalJobs: 1 } });
    }

    // ── Send notification to customer ────────────────────────────────────
    const notifData = {
      accepted:    { title: "Job Accepted! 🎉",  message: "Your worker accepted the job request and will contact you soon." },
      in_progress: { title: "Work Started! 🛠️",  message: "Your worker has started working on your job." },
      completed:   { title: "Job Completed! ✅", message: "Your job is done! Please rate your experience." },
      cancelled:   { title: "Job Rejected ❌",    message: "The worker couldn't take this job. Please book another worker." },
    };

    if (notifData[status] && job.customerId) {
      await Notification.create({
        userId:  job.customerId,
        title:   notifData[status].title,
        message: notifData[status].message,
        type:    status,
        isRead:  false,
      });
    }
    // ─────────────────────────────────────────────────────────────────────

    res.json({ success: true, message: `Job status updated to ${status}` });
  } catch (err) {
    console.error("updateJobStatus error:", err);
    res.status(500).json({ success: false, message: "Database error" });
  }
};

exports.getWorkerStats = async (req, res) => {
  try {
    const wId = req.user.id;
    const [jobs, reviews, earnings] = await Promise.all([
      Job.find({ workerId: wId }),
      Review.find({ workerId: wId }),
      Job.find({ workerId: wId, status: { $in: ["completed", "paid"] } }),
    ]);

    const completed = jobs.filter(j => ["completed", "paid"].includes(j.status)).length;
    const pending = jobs.filter(j => j.status === "pending").length;
    const accepted = jobs.filter(j => j.status === "accepted").length;
    const avgRating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
    const totalEarnings = earnings.reduce((s, j) => s + (j.workerAmount || 0), 0);

    res.json({
      success: true,
      stats: {
        total: jobs.length,
        completed,
        pending,
        accepted,
        avg_rating: avgRating.toFixed(1),
        total_reviews: reviews.length,
        total_earnings: totalEarnings,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching stats" });
  }
};