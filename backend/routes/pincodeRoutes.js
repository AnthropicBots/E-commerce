const express = require("express");
const router = express.Router();
const { checkPincode } = require("../controllers/pincodeController");

router.get("/check/:pincode", checkPincode);

module.exports = router;