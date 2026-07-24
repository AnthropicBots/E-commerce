const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const subscriptionController = require("../controllers/subscriptionController");

// User endpoints
router.post("/subscribe", authMiddleware, subscriptionController.subscribe);
router.post("/pause", authMiddleware, subscriptionController.pause);
router.post("/resume", authMiddleware, subscriptionController.resume);
router.post("/cancel", authMiddleware, subscriptionController.cancel);

module.exports = router;
