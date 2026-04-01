const { User, Job, Review, Notification } = require("../models");

exports.getDashboardStats = async (req, res) => {
  try {
    const [totalCustomers, totalWorkers, totalJobs, pendingVerifications, pendingJobs, revenueData] = await Promise.all([
      User.countDocuments({ role: "customer" }),
      User.countDocuments({ role: "worker" }),
      Job.countDocuments(),
      // ✅ FIX: count workers where idStatus=pending (have uploaded ID but not yet approved)
      User.countDocuments({ role: "worker", idStatus: "pending" }),
      Job.countDocuments({ status: { $in: ["pending", "pending_offer", "negotiating"] } }),
      Job.aggregate([
        { $match: { status: { $in: ["completed", "paid"] } } },
        { $group: { _id: null, total: { $sum: "$commission" } } },
      ]),
    ]);

    const totalRevenue = revenueData[0]?.total || 0;

    const monthlyData = await Job.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          jobs: { $sum: 1 },
          revenue: { $sum: "$commission" },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 6 },
    ]);

    const skillData = await Job.aggregate([
      { $group: { _id: "$skill", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);

    const jobStatusData = await Job.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    res.json({
      success: true,
      stats: { totalCustomers, totalWorkers, totalJobs, totalRevenue, pendingVerifications, pendingJobs },
      charts: { monthlyData, skillDistribution: skillData, jobStatusDistribution: jobStatusData },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching dashboard stats" });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const { role, search, page = 1, limit = 20 } = req.query;
    const query = {};
    if (role) query.role = role;
    if (search) query.$or = [
      { name:  { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];

    const users = await User.find(query)
      .select("-password")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

exports.getAllJobs = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;

    const jobs = await Job.find(query)
      .populate("customerId", "name")
      .populate("workerId", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ─── VERIFY WORKER ──────────────────────────────────────────
// ✅ FIX: Sets BOTH verified=true AND idStatus="approved"
//    The worker dashboard checks USER.verified from localStorage which
//    gets stale — the real fix is to always fetch fresh from /api/auth/profile
exports.verifyWorker = async (req, res) => {
  try {
    const { worker_id } = req.body;
    const worker = await User.findOneAndUpdate(
      { _id: worker_id, role: "worker" },
      {
        verified:         true,        // ✅ admin-verified badge
        idStatus:         "approved",  // ✅ ID document approved
        idVerifiedAt:     new Date(),
        idRejectedReason: null,
      },
      { new: true }
    );
    if (!worker) return res.status(404).json({ success: false, message: "Worker not found" });

    await Notification.create({
      userId:  worker_id,
      title:   "Account Verified ✅",
      message: "Congratulations! Your ID has been verified. You are now a verified worker on KaamConnect.",
      type:    "id_approved",
    });

    res.json({ success: true, message: "Worker verified successfully", worker: {
      _id:          worker._id,
      name:         worker.name,
      verified:     worker.verified,
      idStatus:     worker.idStatus,
      idVerifiedAt: worker.idVerifiedAt,
    }});
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

exports.rejectWorker = async (req, res) => {
  try {
    const { worker_id, reason } = req.body;
    const worker = await User.findOneAndUpdate(
      { _id: worker_id, role: "worker" },
      {
        verified:         false,
        idStatus:         "rejected",
        idRejectedReason: reason || "Did not meet verification requirements",
      },
      { new: true }
    );
    if (!worker) return res.status(404).json({ success: false, message: "Worker not found" });

    await Notification.create({
      userId:  worker_id,
      title:   "Verification Rejected ❌",
      message: reason || "Your ID verification was rejected. Please upload a valid government ID.",
      type:    "id_rejected",
    });

    res.json({ success: true, message: "Worker verification rejected" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

exports.toggleUserStatus = async (req, res) => {
  try {
    const { user_id, is_active } = req.body;
    await User.findByIdAndUpdate(user_id, { isActive: is_active });
    res.json({ success: true, message: `User ${is_active ? "activated" : "deactivated"} successfully` });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.role === "admin") return res.status(403).json({ success: false, message: "Cannot delete admin accounts" });
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "User permanently deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

exports.getRevenue = async (req, res) => {
  try {
    const now = new Date();
    const [totalRes, monthlyRes, chartRes] = await Promise.all([
      Job.aggregate([
        { $match: { status: { $in: ["completed", "paid"] } } },
        { $group: { _id: null, total: { $sum: "$commission" } } },
      ]),
      Job.aggregate([
        {
          $match: {
            status: { $in: ["completed", "paid"] },
            createdAt: {
              $gte: new Date(now.getFullYear(), now.getMonth(), 1),
              $lt:  new Date(now.getFullYear(), now.getMonth() + 1, 1),
            },
          },
        },
        { $group: { _id: null, total: { $sum: "$commission" } } },
      ]),
      Job.aggregate([
        { $match: { status: { $in: ["completed", "paid"] } } },
        {
          $group: {
            _id:          { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
            revenue:      { $sum: "$commission" },
            transactions: { $sum: 1 },
          },
        },
        { $sort: { _id: -1 } },
        { $limit: 12 },
      ]),
    ]);

    res.json({
      success: true,
      totalRevenue:   totalRes[0]?.total || 0,
      monthlyRevenue: monthlyRes[0]?.total || 0,
      revenueChart:   chartRes,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching revenue" });
  }
};

exports.getWorkerDocument = async (req, res) => {
  try {
    const worker = await User.findOne({ _id: req.params.id, role: "worker" })
      .select("name idType idDocument idStatus idRejectedReason idVerifiedAt verified");
    if (!worker) return res.status(404).json({ success: false, message: "Worker not found" });
    res.json({ success: true, worker });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};

// ✅ FIX: Return workers with idStatus="pending" — these are the ones needing approval
exports.getPendingVerifications = async (req, res) => {
  try {
    const workers = await User.find({ role: "worker", idStatus: "pending" })
      .select("-password -idDocument")
      .sort({ createdAt: -1 });
    res.json({ success: true, workers });
  } catch (err) {
    res.status(500).json({ success: false, message: "Database error" });
  }
};
