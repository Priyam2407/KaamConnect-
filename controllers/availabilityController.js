const { User, Job, Notification } = require("../models");

// ─── PUT /api/workers/availability ──────────────────────────
exports.setAvailability = async (req, res) => {
  try {
    const { isAvailable, availabilityNote, availableFrom, availableTo, availableDays } = req.body;
    const update = {};
    if (isAvailable !== undefined) update.isAvailable = isAvailable;
    if (availabilityNote !== undefined) update.availabilityNote = availabilityNote;
    if (availableFrom)  update.availableFrom  = availableFrom;
    if (availableTo)    update.availableTo    = availableTo;
    if (availableDays)  update.availableDays  = availableDays;

    await User.findByIdAndUpdate(req.user.id, update);
    res.json({ success: true, message: isAvailable ? "You are now online" : "You are now offline" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── GET /api/workers/availability ──────────────────────────
exports.getAvailability = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("isAvailable availabilityNote availableFrom availableTo availableDays");
    res.json({ success: true, ...user.toObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── POST /api/jobs/rebook ──────────────────────────────────
// Customer re-books same worker for a new job from a completed job
exports.rebookWorker = async (req, res) => {
  try {
    const { original_job_id, description, location, scheduled_date, scheduled_time, price } = req.body;

    const original = await Job.findOne({
      _id:        original_job_id,
      customerId: req.user.id,
      status:     { $in: ["completed", "paid"] },
    }).populate("workerId", "name isAvailable skill");

    if (!original) return res.status(404).json({ success: false, message: "Original job not found" });
    if (!original.workerId) return res.status(400).json({ success: false, message: "No worker on original job" });

    const worker = original.workerId;
    if (!worker.isAvailable)
      return res.status(400).json({ success: false, message: `${worker.name} is currently unavailable` });

    const budget = parseFloat(price) || original.agreedPrice || original.price;

    const newJob = await Job.create({
      customerId:      req.user.id,
      workerId:        worker._id,
      skill:           original.skill,
      title:           `Re-book: ${original.title || original.skill}`,
      description:     description || original.description,
      location:        location    || original.location,
      customerBudget:  budget,
      price:           budget,
      status:          "pending_offer",
      scheduledDate:   scheduled_date || undefined,
      scheduledTime:   scheduled_time || undefined,
      rebookedFromJob: original._id,
    });

    const { Offer } = require("../models");
    await Offer.create({
      jobId:      newJob._id,
      fromRole:   "customer",
      fromUserId: req.user.id,
      amount:     budget,
      note:       "Re-booking from previous job",
      status:     "pending",
    });

    await Notification.create({
      userId:  worker._id,
      title:   "Re-booking Request! 🔄",
      message: `A previous customer wants to book you again for ${original.skill}. Budget: ₹${budget}`,
      type:    "rebook",
      jobId:   newJob._id,
    });

    res.json({ success: true, message: "Re-book request sent!", job_id: newJob._id });
  } catch (err) {
    console.error("rebookWorker:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ─── POST /api/workers/portfolio ────────────────────────────
exports.addPortfolioPhoto = async (req, res) => {
  try {
    const { url, caption } = req.body;
    if (!url) return res.status(400).json({ success: false, message: "Photo URL required" });

    const user = await User.findById(req.user.id).select("portfolioPhotos");
    if (user.portfolioPhotos.length >= 10)
      return res.status(400).json({ success: false, message: "Max 10 portfolio photos allowed" });

    user.portfolioPhotos.push({ url, caption: caption || "" });
    await user.save();
    res.json({ success: true, message: "Photo added", photos: user.portfolioPhotos });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.removePortfolioPhoto = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, {
      $pull: { portfolioPhotos: { _id: req.params.photoId } },
    });
    res.json({ success: true, message: "Photo removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
