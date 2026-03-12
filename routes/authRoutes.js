const express = require("express");
const router = express.Router();
const auth = require("../controllers/authController");
const { authenticateToken } = require("../middleware/authMiddleware");

router.post("/register", auth.register);
router.post("/login", auth.login);
router.get("/profile", authenticateToken, auth.getProfile);
router.put("/profile", authenticateToken, auth.updateProfile);
router.put("/change-password", authenticateToken, auth.changePassword);

module.exports = router;
