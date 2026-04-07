const express = require("express");
const router  = express.Router();
const ref     = require("../controllers/referralController");
const { authenticateToken } = require("../middleware/authMiddleware");

router.get("/my-code",      authenticateToken, ref.getMyCode);
router.post("/validate",    ref.validateCode);   // public — no auth needed
router.post("/redeem",      authenticateToken, ref.redeemCredits);

module.exports = router;