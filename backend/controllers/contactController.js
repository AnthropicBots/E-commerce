// backend/controllers/contactController.js
//
// POST /api/contact (#1445).

const contactService = require("../services/contactService");

/**
 * Accept a message from the contact form.
 *
 * Open to anyone -- a shopper who cannot sign in is exactly the person who
 * needs to reach support -- so `optionalAuth` attaches an account when there is
 * one and the route is rate limited rather than authenticated.
 */
const submitMessage = async (req, res) => {
    const validation = contactService.validateSubmission(req.body);

    if (!validation.valid) {
        return res.status(400).json({
            success: false,
            message: validation.message
        });
    }

    try {
        const id = await contactService.recordMessage(validation.value, {
            userId: req.user?.id ?? req.user?.userId ?? null,
            ipAddress: req.ip,
            userAgent: req.get("user-agent")
        });

        return res.status(201).json({
            success: true,
            message: "Thanks — your message has reached us and we'll reply by email.",
            data: { id }
        });
    } catch (error) {
        console.error("CONTACT SUBMIT ERROR:", error);

        // The one thing worse than losing the message is telling the sender it
        // arrived. The old frontend did exactly that over a 404; a 500 here is
        // what lets it stop.
        return res.status(500).json({
            success: false,
            message: "We couldn't record your message. Please try again."
        });
    }
};

module.exports = { submitMessage };
