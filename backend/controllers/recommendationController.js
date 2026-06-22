const { asyncHandler, safeInteger, sanitizeString } = require("../utils/helpers");
const interactionService = require("../services/interactionService");
const recommendationService = require("../services/recommendationService");

const recordInteraction = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { productId, type } = req.body;

  const validTypes = ["view", "cart_add", "wishlist_add", "purchase"];
  if (!validTypes.includes(type)) {
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

  await interactionService.recordInteraction(userId, productId, type);

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
