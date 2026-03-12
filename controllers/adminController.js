const { User, Job, Review, Notification } = require("../models");

exports.getDashboardStats = async (req, res) => {
  try {
    const [totalCustomers, totalWorkers, totalJobs, pendingVerifications, pendingJobs, revenueData] = await Promise.all([
      User.countDocuments({ role: "customer" }),
      User.countDocuments({ role: "worker" }),
      Job.countDocuments(),
      User.countDocuments({ role: "worker", verified: false }),
      Job.countDocuments({ status: "pending" }),
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
      stats: {
        totalCustomers,
        totalWorkers,
        totalJobs,
        totalRevenue,
        pendingVerifications,
        pendingJobs,
      },
      charts: {
        monthlyData,
        skillDistribution: skillData,
        jobStatusDistribution: jobStatusData,
      },
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
    if (search) query.$or = [{ name: { $regex: search, $options: "i" } }, { email: { $regex: search, $options: "i" } }];

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

exports.verifyWorker = async (req, res) => {
  try {
    const { worker_id } = req.body;
    const worker = await User.findOneAndUpdate(
      { _id: worker_id, role: "worker" },
      { verified: true }
    );
    if (!worker) return res.status(404).json({ success: false, message: "Worker not found" });

    await Notification.create({
      userId: worker_id,
      title: "Account Verified ✅",
      message: "Congratulations! Your account has been verified by admin.",
      type: "verification",
    });

    res.json({ success: true, message: "Worker verified successfully" });
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
    await User.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: "User deactivated successfully" });
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
              $lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
            },
          },
        },
        { $group: { _id: null, total: { $sum: "$commission" } } },
      ]),
      Job.aggregate([
        { $match: { status: { $in: ["completed", "paid"] } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
            revenue: { $sum: "$commission" },
            transactions: { $sum: 1 },
          },
        },
        { $sort: { _id: -1 } },
        { $limit: 12 },
      ]),
    ]);

    res.json({
      success: true,
      totalRevenue: totalRes[0]?.total || 0,
      monthlyRevenue: monthlyRes[0]?.total || 0,
      revenueChart: chartRes,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error fetching revenue" });
  }
};
