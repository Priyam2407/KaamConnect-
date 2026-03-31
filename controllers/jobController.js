const { Job, Offer, User, Review, Notification } = require("../models");

// ─── Helper: compute commission ─────────────────────────────
function computeCommission(price) {
  const pct = parseFloat(process.env.COMMISSION_PERCENT || 10);
  const commission   = parseFloat((price * pct / 100).toFixed(2));
  const workerAmount = parseFloat((price - commission).toFixed(2));
  return { commission, workerAmount };
}

// ─── Helper: notify ─────────────────────────────────────────
async function notify(userId, title, message, type, jobId = null) {
  try {
    await Notification.create({ userId, title, message, type, jobId, isRead: false });
  } catch (e) { /* non-fatal */ }
}

// ─── POST /api/jobs/create ───────────────────────────────────
// Customer posts a job with their budget. Worker will respond with an offer.
exports.createJob = async (req, res) => {
  try {
    const {
      worker_id, skill, title, description, location, address,
      price, scheduled_date, scheduled_time
    } = req.body;

    if (!worker_id || !skill || !location || !price)
      return res.status(400).json({ success: false, message: "Required fields missing" });

    const budget = parseFloat(price);
    if (isNaN(budget) || budget < 1)
      return res.status(400).json({ success: false, message: "Invalid budget amount" });

    const job = await Job.create({
      customerId:     req.user.id,
      workerId:       worker_id,
      skill,
      title:          title || skill,
      description,
      location,
      address,
      customerBudget: budget,
      price:          budget,   // shown until agreed
      status:         "pending_offer",
      scheduledDate:  scheduled_date || undefined,
      scheduledTime:  scheduled_time || undefined,
    });

    // Create the first offer from customer
    await Offer.create({
      jobId:      job._id,
      fromRole:   "customer",
      fromUserId: req.user.id,
      amount:     budget,
      note:       "Initial budget offer",
      status:     "pending",
    });

    await notify(
      worker_id,
      "New Job Request 💼",
      `New ${skill} job request with budget ₹${budget}. Review and respond with your price.`,
      "new_offer",
      job._id
    );

    res.json({ success: true, message: "Job posted! Waiting for worker's price response.", job_id: job._id });
  } catch (err) {
    console.error("createJob:", err);
    res.status(500).json({ success: false, message: "Failed to create job" });
  }
};

// ─── GET /api/jobs/customer ─────────────────────────────────
exports.getCustomerJobs = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = { customerId: req.user.id };
    if (status) query.status = status;

    const jobs = await Job.find(query)
      .populate("workerId", "name phone skill rating avatar basePrice priceUnit priceNote")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Attach latest offer per job
    const jobIds = jobs.map(j => j._id);
    const offers = await Offer.find({ jobId: { $in: jobIds } }).sort({ createdAt: -1 });
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

// ─── POST /api/jobs/offer ───────────────────────────────────
// Customer sends a counter-offer to worker
exports.sendCustomerOffer = async (req, res) => {
  try {
    const { job_id, amount, note } = req.body;
    const job = await Job.findOne({ _id: job_id, customerId: req.user.id });
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    if (["completed","cancelled","paid","price_agreed"].includes(job.status))
      return res.status(400).json({ success: false, message: "Cannot negotiate at this stage" });

    const offerAmt = parseFloat(amount);
    if (isNaN(offerAmt) || offerAmt < 1)
      return res.status(400).json({ success: false, message: "Invalid amount" });

    // Mark previous pending offers as countered
    await Offer.updateMany({ jobId: job_id, status: "pending" }, { status: "countered" });

    await Offer.create({
      jobId:      job_id,
      fromRole:   "customer",
      fromUserId: req.user.id,
      amount:     offerAmt,
      note:       note || null,
      status:     "pending",
    });

    await Job.findByIdAndUpdate(job_id, { status: "negotiating", price: offerAmt, customerBudget: offerAmt });

    await notify(
      job.workerId,
      "Counter Offer from Customer 💬",
      `Customer offered ₹${offerAmt} for the job. Accept or counter.`,
      "counter_offer",
      job._id
    );

    res.json({ success: true, message: "Counter offer sent to worker" });
  } catch (err) {
    console.error("sendCustomerOffer:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── POST /api/jobs/accept-price ────────────────────────────
// Customer accepts the worker's latest offer price
exports.acceptWorkerPrice = async (req, res) => {
  try {
    const { job_id } = req.body;
    const job = await Job.findOne({ _id: job_id, customerId: req.user.id });
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    // Find the latest pending offer from worker
    const latestOffer = await Offer.findOne({
      jobId: job_id, fromRole: "worker", status: "pending"
    }).sort({ createdAt: -1 });

    if (!latestOffer)
      return res.status(400).json({ success: false, message: "No worker offer to accept" });

    const agreedPrice = latestOffer.amount;
    const { commission, workerAmount } = computeCommission(agreedPrice);

    await Offer.findByIdAndUpdate(latestOffer._id, { status: "accepted" });
    await Job.findByIdAndUpdate(job_id, {
      status:      "price_agreed",
      agreedPrice,
      price:       agreedPrice,
      commission,
      workerAmount,
    });

    await notify(
      job.workerId,
      "Price Accepted! 🎉",
      `Customer accepted your price of ₹${agreedPrice}. Get ready to start work!`,
      "price_agreed",
      job._id
    );

    res.json({ success: true, message: `Price ₹${agreedPrice} agreed! Worker will start soon.` });
  } catch (err) {
    console.error("acceptWorkerPrice:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── GET /api/jobs/offers/:job_id ───────────────────────────
exports.getJobOffers = async (req, res) => {
  try {
    const { job_id } = req.params;
    const job = await Job.findOne({
      _id: job_id,
      $or: [{ customerId: req.user.id }, { workerId: req.user.id }],
    });
    if (!job) return res.status(404).json({ success: false, message: "Not found" });

    const offers = await Offer.find({ jobId: job_id }).sort({ createdAt: 1 });
    res.json({ success: true, offers, job });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── PUT /api/jobs/cancel/:id ───────────────────────────────
exports.cancelJob = async (req, res) => {
  try {
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, customerId: req.user.id, status: { $in: ["pending_offer","negotiating","price_agreed"] } },
      { status: "cancelled", cancelledBy: "customer" }
    );
    if (!job) return res.status(404).json({ success: false, message: "Job not found or cannot be cancelled" });

    await Offer.updateMany({ jobId: req.params.id, status: "pending" }, { status: "rejected" });

    if (job.workerId) {
      await notify(job.workerId, "Job Cancelled ❌", "Customer cancelled the job.", "cancelled", job._id);
    }

    res.json({ success: true, message: "Job cancelled" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ─── POST /api/jobs/review ──────────────────────────────────
exports.submitReview = async (req, res) => {
  try {
    const { job_id, worker_id, rating, review } = req.body;
    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ success: false, message: "Rating must be 1-5" });

    await Review.create({ jobId: job_id, workerId: worker_id, customerId: req.user.id, rating, review });
    await Job.findByIdAndUpdate(job_id, { rating, review });

    const reviews = await Review.find({ workerId: worker_id });
    const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
    await User.findByIdAndUpdate(worker_id, { rating: parseFloat(avg.toFixed(2)) });

    res.json({ success: true, message: "Review submitted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to submit review" });
  }
};

// ─── GET /api/jobs/stats ─────────────────────────────────────
exports.getCustomerStats = async (req, res) => {
  try {
    const jobs = await Job.find({ customerId: req.user.id });
    const completed  = jobs.filter(j => ["completed","paid"].includes(j.status)).length;
    const pending    = jobs.filter(j => ["pending_offer","negotiating","price_agreed"].includes(j.status)).length;
    const totalSpent = jobs.filter(j => ["completed","paid"].includes(j.status))
      .reduce((s, j) => s + (j.agreedPrice || j.price || 0), 0);

    res.json({ success: true, stats: { total: jobs.length, completed, pending, totalSpent } });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error" });
  }
};

// ─── Notifications ─────────────────────────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 }).limit(20);
    res.json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};
exports.markNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.id }, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};
