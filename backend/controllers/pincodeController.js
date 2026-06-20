const Pincode = require("../models/Pincode");

const checkPincode = async (req, res) => {
  const { pincode } = req.params;

  if (!pincode || !/^\d{6}$/.test(pincode)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid 6-digit pincode.",
    });
  }

  try {
    const results = await Pincode.findByCode(pincode);

    if (results.length === 0) {
      return res.status(200).json({
        success: true,
        deliverable: false,
        message: "Sorry, delivery is not currently available at this pincode.",
      });
    }

    const { eta_days, city, state } = results[0];

    return res.status(200).json({
      success: true,
      deliverable: true,
      eta_days,
      city,
      state,
      message: `Delivery available! Estimated delivery in ${eta_days} day(s) to ${city}, ${state}.`,
    });
  } catch (error) {
    console.error("Pincode check error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
};

module.exports = { checkPincode };