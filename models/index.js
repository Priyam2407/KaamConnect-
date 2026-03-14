const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// ─── USER MODEL ────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    phone: { type: String, trim: true },
    role: { type: String, enum: ["customer", "worker", "admin"], default: "customer" },
    skill: { type: String, lowercase: true, trim: true },
    location: { type: String, trim: true },
    avatar: { type: String },
    bio: { type: String, maxlength: 500 },
    verified: { type: Boolean, default: false },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    totalJobs: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    subscriptionStatus: { type: String, enum: ["free", "basic", "premium"], default: "free" },
    subscriptionExpires: { type: Date },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

// ─── JOB MODEL ─────────────────────────────────────────────
const jobSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    workerId:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    skill:       { type: String, required: true, lowercase: true },
    title:       { type: String, trim: true },
    description: { type: String },
    location:    { type: String, required: true },
    address:     { type: String },
    price:        { type: Number, required: true, min: 0 },
    commission:   { type: Number, default: 0 },
    workerAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: [
        "pending",      // Job created, waiting for worker to accept
        "accepted",     // Worker accepted the job
        "in_progress",  // Worker started the job
        "completed",    // Worker marked job as done
        "cancelled",    // Worker rejected OR customer cancelled
        "paid",         // Payment released to worker
      ],
      default: "pending",
    },
    scheduledDate:     { type: Date },
    scheduledTime:     { type: String },
    completedAt:       { type: Date },
    cancelledBy:       { type: String, enum: ["customer", "worker"], default: null }, // track who cancelled
    rating:  { type: Number, min: 1, max: 5 },
    review:  { type: String },
    razorpayOrderId:   { type: String },
    razorpayPaymentId: { type: String },
  },
  { timestamps: true }
);

// ─── MESSAGE MODEL ─────────────────────────────────────────
const messageSchema = new mongoose.Schema(
  {
    jobId:       { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
    senderId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiverId:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    message:     { type: String, required: true },
    isRead:      { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ─── REVIEW MODEL ──────────────────────────────────────────
const reviewSchema = new mongoose.Schema(
  {
    jobId:       { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    workerId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rating:      { type: Number, required: true, min: 1, max: 5 },
    review:      { type: String },
  },
  { timestamps: true }
);

// ─── NOTIFICATION MODEL ────────────────────────────────────
const notificationSchema = new mongoose.Schema(
  {
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title:   { type: String, required: true },
    message: { type: String, required: true },
    type:    {
      type: String,
      enum: ["accepted", "in_progress", "completed", "cancelled", "new_job", "payment", "general"],
      default: "general",
    },
    isRead:  { type: Boolean, default: false },
    jobId:   { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null },
  },
  { timestamps: true }
);

module.exports = {
  User:         mongoose.model("User",         userSchema),
  Job:          mongoose.model("Job",          jobSchema),
  Message:      mongoose.model("Message",      messageSchema),
  Review:       mongoose.model("Review",       reviewSchema),
  Notification: mongoose.model("Notification", notificationSchema),
};