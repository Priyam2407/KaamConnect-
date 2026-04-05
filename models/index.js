const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

// ─── USER MODEL ────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, minlength: 6, default: null },
    googleId: { type: String, default: null, sparse: true },
    phone:    { type: String, trim: true },
    role:     { type: String, enum: ["customer", "worker", "admin"], default: "customer" },
    skill:    { type: String, lowercase: true, trim: true },
    location: { type: String, trim: true },
    avatar:   { type: String },
    bio:      { type: String, maxlength: 500 },

    // Worker pricing
    basePrice: { type: Number, default: null, min: 0 },
    priceUnit: { type: String, enum: ["job", "hour", "day"], default: "job" },
    priceNote: { type: String, maxlength: 200 },

    // ── Worker availability ──────────────────────────────────
    isAvailable:       { type: Boolean, default: true },   // online/offline toggle
    availabilityNote:  { type: String, maxlength: 200 },   // "back Monday" etc
    availableFrom:     { type: String },                   // "09:00"
    availableTo:       { type: String },                   // "18:00"
    availableDays:     { type: [String], default: ["Mon","Tue","Wed","Thu","Fri","Sat"] },

    // ── Referral system ─────────────────────────────────────
    referralCode:      { type: String, unique: true, sparse: true },
    referredBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    referralCredits:   { type: Number, default: 0 },      // wallet balance in ₹
    totalReferrals:    { type: Number, default: 0 },

    // ── Subscription ─────────────────────────────────────────
    subscriptionStatus:  { type: String, enum: ["free", "basic", "premium"], default: "free" },
    subscriptionExpires: { type: Date },
    subscriptionTxnId:   { type: String },

    // Worker stats
    verified:  { type: Boolean, default: false },
    rating:    { type: Number, default: 0, min: 0, max: 5 },
    totalJobs: { type: Number, default: 0 },
    isActive:  { type: Boolean, default: true },

    // Worker portfolio photos
    portfolioPhotos: [{ url: String, caption: String, addedAt: { type: Date, default: Date.now } }],

    // Email verification
    emailVerified:      { type: Boolean, default: false },
    emailVerifyToken:   { type: String, default: null },
    emailVerifyExpires: { type: Date, default: null },

    idType: {
      type: String,
      enum: ["aadhaar", "pan", "voter", "driving", "passport", "other", null],
      default: null,
    },
    idDocument:       { type: String, default: null },
    idVerifiedAt:     { type: Date, default: null },
    idRejectedReason: { type: String, default: null },
    idStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
    },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  if (!this.password) return next();
  if (this.password.startsWith("google_oauth_") && !this.isNew) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});
userSchema.methods.comparePassword = async function (p) {
  if (!this.password) return false;
  return bcrypt.compare(p, this.password);
};
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

// ─── JOB MODEL ─────────────────────────────────────────────
const jobSchema = new mongoose.Schema(
  {
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    workerId:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    skill:       { type: String, required: true, lowercase: true },
    title:       { type: String, trim: true },
    description: { type: String },
    location:    { type: String, required: true },
    address:     { type: String },

    customerBudget: { type: Number, required: true, min: 0 },
    agreedPrice:    { type: Number, default: null },
    price:          { type: Number, default: 0 },
    commission:     { type: Number, default: 0 },
    workerAmount:   { type: Number, default: 0 },

    // Re-book tracking
    rebookedFromJob: { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null },
    isUrgent:        { type: Boolean, default: false }, // emergency booking flag

    status: {
      type: String,
      enum: ["pending_offer","negotiating","price_agreed","accepted","in_progress","completed","cancelled","paid"],
      default: "pending_offer",
    },
    scheduledDate:     { type: Date },
    scheduledTime:     { type: String },
    completedAt:       { type: Date },
    cancelledBy:       { type: String, enum: ["customer", "worker", null], default: null },
    rating:            { type: Number, min: 1, max: 5 },
    review:            { type: String },
    razorpayOrderId:   { type: String },
    razorpayPaymentId: { type: String },
  },
  { timestamps: true }
);

// ─── OFFER MODEL ───────────────────────────────────────────
const offerSchema = new mongoose.Schema(
  {
    jobId:      { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    fromRole:   { type: String, enum: ["customer", "worker"], required: true },
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount:     { type: Number, required: true, min: 0 },
    note:       { type: String, maxlength: 300 },
    status:     { type: String, enum: ["pending", "accepted", "countered", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

// ─── REFERRAL MODEL ────────────────────────────────────────
const referralSchema = new mongoose.Schema(
  {
    referrerId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    refereeId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    referralCode: { type: String, required: true },
    creditsEarned:{ type: Number, default: 50 }, // ₹50 per referral
    status:       { type: String, enum: ["pending", "credited", "expired"], default: "pending" },
  },
  { timestamps: true }
);

// ─── MESSAGE MODEL ─────────────────────────────────────────
const messageSchema = new mongoose.Schema(
  {
    jobId:      { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
    senderId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    message:    { type: String, required: true },
    read:       { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ─── REVIEW MODEL ──────────────────────────────────────────
const reviewSchema = new mongoose.Schema(
  {
    jobId:      { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
    workerId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rating:     { type: Number, required: true, min: 1, max: 5 },
    review:     { type: String },
  },
  { timestamps: true }
);

// ─── NOTIFICATION MODEL ────────────────────────────────────
const notificationSchema = new mongoose.Schema(
  {
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title:   { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ["accepted","in_progress","completed","cancelled","new_job",
             "payment","general","verification","id_approved","id_rejected",
             "new_offer","counter_offer","offer_accepted","offer_rejected","price_agreed",
             "referral_credited","subscription_activated","rebook"],
      default: "general",
    },
    isRead: { type: Boolean, default: false },
    jobId:  { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null },
  },
  { timestamps: true }
);

// ─── PENDING USER MODEL ────────────────────────────────────
const pendingUserSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true },
    email:       { type: String, required: true, unique: true, lowercase: true },
    password:    { type: String, required: true },
    phone:       { type: String },
    role:        { type: String, default: "customer" },
    skill:       { type: String },
    location:    { type: String },
    bio:         { type: String },
    idType:      { type: String, default: null },
    idDocument:  { type: String, default: null },
    referralCode:{ type: String, default: null }, // code used during signup
    verifyToken: { type: String, required: true },
    expiresAt:   { type: Date, required: true },
  },
  { timestamps: true }
);
pendingUserSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const PendingUser = mongoose.models.PendingUser || mongoose.model("PendingUser", pendingUserSchema);

module.exports = {
  User:         mongoose.model("User",         userSchema),
  PendingUser,
  Job:          mongoose.model("Job",          jobSchema),
  Offer:        mongoose.model("Offer",        offerSchema),
  Referral:     mongoose.model("Referral",     referralSchema),
  Message:      mongoose.model("Message",      messageSchema),
  Review:       mongoose.model("Review",       reviewSchema),
  Notification: mongoose.model("Notification", notificationSchema),
};
