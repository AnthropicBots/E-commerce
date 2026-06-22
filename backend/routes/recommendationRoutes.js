const express = require("express");
const router = express.Router();

const {
  recordInteraction,
  getRecommendations,
} = require("../controllers/recommendationController");
const authMiddleware = require("../middleware/authMiddleware");

// All recommendation routes require authentication
router.use(authMiddleware);

router.post("/interaction", recordInteraction);
router.get("/", getRecommendations);

module.exports = router;
