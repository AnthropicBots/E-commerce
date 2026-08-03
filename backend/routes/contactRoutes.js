// backend/routes/contactRoutes.js
//
// The endpoint contact.html has been posting to all along (#1445).

const express = require("express");
const router = express.Router();

const { optionalAuth } = require("../middleware/authMiddleware");
const { contactFormLimiter } = require("../middleware/rateLimiter");
const contactController = require("../controllers/contactController");

// Unauthenticated and it writes a row, so the limiter is the only thing
// between the form and a table full of somebody's script. Applied before the
// handler, and deliberately not before `optionalAuth` -- being signed in
// should not buy a bigger budget for this.
router.post("/", optionalAuth, contactFormLimiter, contactController.submitMessage);

router.use((req, res) => {
    res.status(404).json({ success: false, message: "Contact route not found" });
});

module.exports = router;
