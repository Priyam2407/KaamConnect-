const express = require("express");
const router  = express.Router();
const ref     = require("../controllers/referralController");
const { authenticateToken } = require("../middleware/authMiddleware");

router.get("/my-code",      authenticateToken, ref.getMyCode);
router.post("/redeem",      authenticateToken, ref.redeemCredits);

module.exports = router;
