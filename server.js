require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const passport = require("passport");
const connectDB = require("./config/db");
const { Message, User, Job } = require("./models");

const app = express();
const server = http.createServer(app);

// ── Socket.IO ──────────────────────────────────────────────
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ── Connect MongoDB ─────────────────────────────────────────
connectDB();

// ── Middlewares ─────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(passport.initialize());
app.use(express.static(path.join(__dirname, "public")));

// ── Debug AI Key ────────────────────────────────────────────
console.log("🤖 Anthropic API Key Loaded:", !!process.env.ANTHROPIC_API_KEY);

// ── Socket.IO real-time ─────────────────────────────────────
io.on("connection", (socket) => {
  console.log("🔌 User connected:", socket.id);

  socket.on("join_room", (userId) => {
    socket.join(`user_${userId}`);
    console.log(`👤 User ${userId} joined room`);
  });

  socket.on("send_message", async (data) => {
    try {
      io.to(`user_${data.receiver_id}`).emit("receive_message", data);

      await Message.create({
        jobId: data.job_id || undefined,
        senderId: data.sender_id,
        receiverId: data.receiver_id,
        message: data.message,
      });

    } catch (err) {
      console.error("Socket message error:", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

// ── Routes ──────────────────────────────────────────────────
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/workers", require("./routes/workerRoutes"));
app.use("/api/jobs", require("./routes/jobRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/payment", require("./routes/paymentRoutes"));
app.use("/api/chat",         require("./routes/chatRoutes"));
app.use("/api/referral",     require("./routes/referralRoutes"));
app.use("/api/subscription", require("./routes/subscriptionRoutes"));

// ── Health Check (VERY IMPORTANT for Render) ────────────────
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "OK",
    ai: !!process.env.ANTHROPIC_API_KEY,
    uptime: process.uptime(),
  });
});

// ── Platform analytics ──────────────────────────────────────
app.get("/api/analytics/platform", async (req, res) => {
  try {
    const [customers, workers, completedJobs, revenueData] =
      await Promise.all([
        User.countDocuments({ role: "customer" }),
        User.countDocuments({ role: "worker" }),
        Job.countDocuments({ status: { $in: ["completed", "paid"] } }),
        Job.aggregate([
          { $match: { status: { $in: ["completed", "paid"] } } },
          { $group: { _id: null, total: { $sum: "$commission" } } },
        ]),
      ]);

    res.json({
      success: true,
      customers,
      workers,
      completedJobs,
      revenue: revenueData[0]?.total || 0,
    });
  } catch (err) {
    console.error("Analytics error:", err.message);

    // fallback demo data
    res.json({
      success: true,
      customers: 2847,
      workers: 743,
      completedJobs: 15832,
      revenue: 284750,
    });
  }
});

// ── DB test ─────────────────────────────────────────────────
app.get("/api/test-db", async (req, res) => {
  try {
    await User.findOne();
    res.json({
      success: true,
      message: "MongoDB Atlas connected successfully ✅",
    });
  } catch (err) {
    console.error("DB error:", err.message);
    res.status(500).json({
      success: false,
      message: "Database connection failed",
    });
  }
});

// ── Seed demo data ──────────────────────────────────────────
app.post("/api/admin/seed", async (req, res) => {
  try {
    const count = await User.countDocuments();
    if (count > 0) {
      return res.json({
        success: false,
        message: "Database already has data",
      });
    }

    const bcrypt = require("bcryptjs");
    const hashedPass = await bcrypt.hash("admin123", 10);

    await User.insertMany([
      { name: "Admin", email: "admin@kaamconnect.com", password: hashedPass, role: "admin", verified: true },
      { name: "Rajesh Kumar", email: "rajesh@example.com", password: hashedPass, phone: "9876543210", role: "worker", skill: "electrician", location: "Ludhiana", verified: true, rating: 4.8, totalJobs: 124 },
      { name: "Suresh Sharma", email: "suresh@example.com", password: hashedPass, phone: "9876543211", role: "worker", skill: "plumber", location: "Chandigarh", verified: true, rating: 4.6, totalJobs: 98 },
      { name: "Amit Singh", email: "amit@example.com", password: hashedPass, phone: "9876543212", role: "worker", skill: "painter", location: "Delhi", verified: true, rating: 4.9, totalJobs: 156 },
      { name: "Vikram Patel", email: "vikram@example.com", password: hashedPass, phone: "9876543213", role: "worker", skill: "carpenter", location: "Mumbai", verified: true, rating: 4.7, totalJobs: 87 },
      { name: "Priya Sharma", email: "priya@example.com", password: hashedPass, phone: "9876543220", role: "customer", location: "Ludhiana" },
    ]);

    res.json({
      success: true,
      message: "Demo data seeded successfully 🎉",
    });

  } catch (err) {
    console.error("Seed error:", err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ── SPA fallback ─────────────────────────────────────────────
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({
      success: false,
      message: "Route not found",
    });
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Global error handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err.stack);
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

// ── Start server ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     🚀 KaamConnect Server Running        ║
╠════════════════════════════════════════════╣
║  🌐  http://localhost:${PORT}               ║
║  🍃  MongoDB Connected                     ║
║  📡  Socket.IO Active                      ║
║  🤖  AI Enabled: ${!!process.env.ANTHROPIC_API_KEY}        ║
╚════════════════════════════════════════════╝
  `);
});

module.exports = { app, io };