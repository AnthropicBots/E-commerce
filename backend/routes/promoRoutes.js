const express = require("express");
const router = express.Router();
const { validatePromoCode } = require("../controllers/promo.controller");

router.post("/validate", validatePromoCode);

module.exports = router;
