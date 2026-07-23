const { asyncHandler, safeInteger, sanitizeString } = require("../utils/helpers");
const interactionService = require("../services/interactionService");
const recommendationService = require("../services/recommendationService");
const { INTERACTION_TYPES } = require("../constants/interactionTypes");

const recordInteraction = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { productId } = req.body;
  const normalizedType = sanitizeString(req.body.type || "").trim().toLowerCase();

  if (!Object.values(INTERACTION_TYPES).includes(normalizedType)) {
    return res.status(400).json({
      success: false,
      message: "Invalid interaction type",
    });
  }

  if (!productId) {
    return res.status(400).json({
      success: false,
      message: "Product ID is required",
    });
  }

  await interactionService.recordInteraction(userId, productId, normalizedType);

  return res.status(200).json({
    success: true,
    message: "Interaction recorded successfully",
  });
});

const getRecommendations = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const limit = safeInteger(req.query.limit, 8);

  const recommendations = await recommendationService.getRecommendations(userId, limit);

  return res.status(200).json({
    success: true,
    data: recommendations,
    message: "Recommendations fetched successfully",
  });
});

module.exports = {
  recordInteraction,
  getRecommendations,
};
