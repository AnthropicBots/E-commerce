const db = require("../config/db");

const interactionService = {
  recordInteraction: async (userId, productId, interactionType) => {
    try {
      const query = `
        INSERT INTO user_interactions (user_id, product_id, interaction_type)
        VALUES (?, ?, ?)
      `;
      await db.query(query, [userId, productId, interactionType]);
      return true;
    } catch (error) {
      console.error("Error recording user interaction:", error);
      throw error;
    }
  }
};

module.exports = interactionService;
