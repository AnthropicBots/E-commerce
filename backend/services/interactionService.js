const db = require("../config/db");
const { safeUUID } = require("../utils/helpers");

// Mirrors the `user_interactions.interaction_type` ENUM. MySQL in strict mode
// refuses a value outside the enum rather than coercing it, so a type this list
// does not know about is a failed insert -- which is what would have happened
// to every 'share' the product page sends had migration 0042 not added the
// member (#1445).
const INTERACTION_TYPES = Object.freeze([
    "view",
    "cart_add",
    "wishlist_add",
    "purchase",
    "share"
]);

/**
 * Is this a type the column will accept?
 *
 * @param {*} value
 * @returns {boolean}
 */
function isSupportedType(value) {
    return typeof value === "string" && INTERACTION_TYPES.includes(value);
}

const interactionService = {
  INTERACTION_TYPES,
  isSupportedType,

  recordInteraction: async (userId, productId, interactionType, metadata = null) => {
    // Two callers reach this now -- the recommendation controller with ids it
    // already trusts, and the interactions route with ids off a request body.
    // Checking here means neither has to remember to.
    const user = safeUUID(userId);
    const product = safeUUID(productId);

    if (!user || !product) {
      throw new Error("Interaction requires a valid user and product id");
    }

    if (!isSupportedType(interactionType)) {
      throw new Error(`Unsupported interaction type: ${interactionType}`);
    }

    try {
      const query = `
        INSERT INTO user_interactions (user_id, product_id, interaction_type, metadata)
        VALUES (?, ?, ?, ?)
      `;
      await db.query(query, [
        user,
        product,
        interactionType,
        metadata ? JSON.stringify(metadata) : null
      ]);
      return true;
    } catch (error) {
      console.error("Error recording user interaction:", error);
      throw error;
    }
  }
};

module.exports = interactionService;
