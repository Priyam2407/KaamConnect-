const { Job, User, Review, Notification } = require("../models");

exports.createJob = async (req, res) => {
  try {
    const { worker_id, skill, title, description, location, address, price, scheduled_date, scheduled_time } = req.body;
    if (!worker_id || !skill || !location || !price)
      return res.status(400).json({ success: false, message: "Required fields missing" });

    const commissionPercent = parseFloat(process.env.COMMISSION_PERCENT || 10);
    const commission = price * commissionPercent / 100;
    const workerAmount = price - commission;

    const job = await Job.create({
      customerId: req.user.id,
      workerId: worker_id,
      skill,
      title,
      description,
      location,
      address,
      price,
      commission,
      workerAmount,
      scheduledDate: scheduled_date || undefined,
      scheduledTime: scheduled_time || undefined,
    });

    await Notification.create({
      userId: worker_id,
      title: "New Job Request",
      message: `You have a new job request for ${skill}`,
      type: "new_job",
    });

    res.json({ success: true, message: "Job created successfully", job_id: job._id });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to create job" });
  }
};

exports.getCustomerJobs = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const query = { customerId: req.user.id };
    if (status) query.status = status;

    const jobs = await Job.find(query)
      .populate("workerId", "name phone skill rating")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

exports.cancelJob = async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, customerId: req.user.id, status: "pending" },
      { status: "cancelled" }
    );
    if (!job) return res.status(404).json({ success: false, message: "Job not found or cannot be cancelled" });
    res.json({ success: true, message: "Job cancelled successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

exports.submitReview = async (req, res) => {
  try {
    const { job_id, worker_id, rating, review } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ success: false, message: "Rating must be between 1 and 5" });

    await Review.create({ jobId: job_id, workerId: worker_id, customerId: req.user.id, rating, review });
    await Job.findByIdAndUpdate(job_id, { rating, review });

    const reviews = await Review.find({ workerId: worker_id });
    const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
    await User.findByIdAndUpdate(worker_id, { rating: parseFloat(avgRating.toFixed(2)) });

    res.json({ success: true, message: "Review submitted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to submit review" });
  }
};

exports.getCustomerStats = async (req, res) => {
  try {
    const cId = req.user.id;
    const jobs = await Job.find({ customerId: cId });

    const completed = jobs.filter(j => ["completed", "paid"].includes(j.status)).length;
    const pending = jobs.filter(j => j.status === "pending").length;
    const totalSpent = jobs.filter(j => ["completed", "paid"].includes(j.status))
      .reduce((s, j) => s + (j.price || 0), 0);

    res.json({
      success: true,
      stats: { total: jobs.length, completed, pending, totalSpent },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching stats" });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(20);
    res.json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

exports.markNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.id }, { isRead: true });
    res.json({ success: true, message: "Notifications marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};