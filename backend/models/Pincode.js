const db = require("../config/db");

const Pincode = {
  findByCode: async (pincode) => {
    const [rows] = await db.query(
      "SELECT * FROM serviceable_pincodes WHERE pincode = ? AND is_active = TRUE",
      [pincode]
    );
    return rows;
  },
};

module.exports = Pincode;