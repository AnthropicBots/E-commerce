// backend/controllers/newsletterController.js
//
// The HTTP surface for the newsletter list (#1459).
//
// The interesting decision here is that `subscribe` answers the same way
// whatever happens. See the constant below.

'use strict';

const newsletterService = require('../services/newsletterService');
const logger = require('../config/logger');

/**
 * The one thing POST /subscribe says.
 *
 * A new address, an address already pending, an address already confirmed and a
 * malformed address all get this. Anything else and the form is a membership
 * oracle: "you are already subscribed" tells an anonymous caller that a
 * particular person is on this list, which is a fact about that person and not
 * about the caller. Same reasoning as /forgot-password in #1455.
 *
 * The copy is honest about the confirmation step, which is what the old
 * frontend was not -- it said "Thanks for subscribing!" over a request it had
 * never made.
 */
const SUBSCRIBE_RESPONSE = Object.freeze({
    success: true,
    message:
        'Almost there — check your email for a link to confirm your subscription.'
});

/**
 * POST /api/newsletter/subscribe
 */
const subscribe = async (req, res) => {
    const respond = () => res.status(200).json(SUBSCRIBE_RESPONSE);

    try {
        const { email, source } = req.body || {};

        const result = await newsletterService.subscribe({
            email,
            // Which page the form was on, for the consent record. Caller-supplied
            // and therefore capped and not trusted for anything but the record.
            sourcePage: typeof source === 'string' ? source.slice(0, 255) : null,
            ip: req.ip || null,
            userId: req.user?.id || null
        });

        // Logged, not returned. The outcome is the part that would leak.
        logger.info(`Newsletter subscribe: ${result.outcome}`);

        return respond();
    } catch (error) {
        // Even a failure answers the same way. A 500 for a real address and a
        // 200 for a malformed one is the oracle again, in a slower form.
        logger.error(`Newsletter subscribe failed: ${error.message}`);
        return respond();
    }
};

/**
 * POST /api/newsletter/confirm
 *
 * Unlike subscribe, this one does report what happened, and can: the caller is
 * holding a token that was mailed to the address, so they have already
 * demonstrated they are the person entitled to know.
 */
const confirm = async (req, res) => {
    try {
        const token = req.body?.token || req.query?.token;
        const result = await newsletterService.confirm(token);

        if (result.confirmed) {
            return res.status(200).json({
                success: true,
                message: "You're subscribed. Thanks for signing up."
            });
        }

        if (result.reason === 'expired') {
            return res.status(410).json({
                success: false,
                message:
                    'That confirmation link has expired or has already been used. '
                    + 'Sign up again to get a new one.'
            });
        }

        return res.status(400).json({
            success: false,
            message: 'That confirmation link is not valid.'
        });
    } catch (error) {
        logger.error(`Newsletter confirm failed: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'Could not confirm the subscription. Please try again.'
        });
    }
};

/**
 * POST /api/newsletter/unsubscribe
 *
 * Succeeds when clicked twice. An unsubscribe link that errors the second time
 * reads as "that did not work", and the reasonable response to that is to click
 * it again -- or to mark the next mailing as spam.
 */
const unsubscribe = async (req, res) => {
    try {
        const token = req.body?.token || req.query?.token;
        const result = await newsletterService.unsubscribe(token);

        if (!result.unsubscribed) {
            return res.status(400).json({
                success: false,
                message: 'That unsubscribe link is not valid.'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'You have been unsubscribed. We will not email you again.'
        });
    } catch (error) {
        logger.error(`Newsletter unsubscribe failed: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'Could not unsubscribe. Please try again.'
        });
    }
};

module.exports = {
    subscribe,
    confirm,
    unsubscribe,
    SUBSCRIBE_RESPONSE
};
