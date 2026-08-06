// backend/routes/interactionRoutes.js
//
// The endpoint product.js has been posting shares to all along (#1445).
//
// `user_interactions` and the service that writes to it both already existed;
// recommendationController was its only caller and no route exposed it, so
// every share the product page recorded went to a 404. The frontend swallows
// the failure by design (console.debug, never block the shopper), which is why
// nobody noticed.

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const interactionService = require("../services/interactionService");
const { safeUUID, sanitizeString } = require("../utils/helpers");

// An interaction is attributed to an account -- `user_interactions.user_id` is
// NOT NULL with a foreign key onto users -- so this is not a route a guest can
// use. product.js already checks `isAuthenticated()` before calling it.
router.post("/", authMiddleware, async (req, res) => {
    const productId = safeUUID(req.body?.productId);
    const type = sanitizeString(req.body?.type);

    if (!productId) {
        return res.status(400).json({
            success: false,
            message: "A valid product ID is required"
        });
    }

    if (!interactionService.isSupportedType(type)) {
        return res.status(400).json({
            success: false,
            message: `Interaction type must be one of: ${interactionService.INTERACTION_TYPES.join(", ")}`
        });
    }

    // Whatever else the caller sent, minus the two fields that are columns.
    // A share carries `method` ("whatsapp", "copy-link"); a future interaction
    // will carry something else, and neither is worth a migration.
    const { productId: _id, type: _type, ...rest } = req.body || {};
    const metadata = Object.keys(rest).length > 0 ? rest : null;

    try {
        await interactionService.recordInteraction(
            req.user?.id ?? req.user?.userId,
            productId,
            type,
            metadata
        );

        return res.status(201).json({
            success: true,
            message: "Interaction recorded"
        });
    } catch (error) {
        console.error("RECORD INTERACTION ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to record interaction"
        });
    }
});

router.use((req, res) => {
    res.status(404).json({ success: false, message: "Interaction route not found" });
});

module.exports = router;
