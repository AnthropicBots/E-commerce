
//
// This file used to hold the rules: a hand-taken pool connection, an existence
// check and an insert issued outside any transaction, and its own copy of the
// four-branch period arithmetic that the renewal job also carried. Both copies
// fell through their `else if` chain on an unrecognised interval and produced a
// period of zero length. The rules are in the service now, so there is one of
// each, and the job and these handlers are both callers.
//
// There were also no reads. Four routes, all writes: a shopper could subscribe,
// pause, resume and cancel, and had no way to see what they were subscribed to,
// when the period ended, or that a cancellation was pending. `GET /me` and
// `GET /plans` are the missing half.

'use strict';

const subscriptionService = require('../services/subscriptionService');
const { SubscriptionError } = require('../services/subscriptionService');

/**
 * Map a thrown error onto a response.
 *
 * SubscriptionError carries the status it wants. Anything else is unexpected,
 * so the detail goes to the log and the caller gets a generic message.
 *
 * @param {import('express').Response} res
 * @param {Error} error
 * @param {string} context
 */
function handleError(res, error, context) {
    if (error instanceof SubscriptionError) {
        return res.status(error.status).json({
            success: false,
            message: error.message,
            code: error.code
        });
    }

    console.error(`${context}:`, error);

    return res.status(500).json({
        success: false,
        message: 'Something went wrong. Please try again.'
    });
}

/** The id on the token, under either of the two names login paths mint. */
function callerId(req) {
    return req.user && (req.user.id || req.user.userId);
}

const subscriptionController = {
    /**
     * GET /api/subscriptions/plans
     *
     * Public: you cannot choose a plan you cannot see, and choosing one is the
     * step before having an account is required.
     */
    listPlans: async (req, res) => {
        try {
            const plans = await subscriptionService.listPlans();

            return res.status(200).json({
                success: true,
                message: 'Billing plans retrieved',
                data: { plans }
            });
        } catch (error) {
            return handleError(res, error, 'LIST BILLING PLANS ERROR');
        }
    },

    /**
     * GET /api/subscriptions/me
     *
     * The caller's own subscription, or null. 200 with null rather than 404:
     * "you have no subscription" is a successful answer to "what am I
     * subscribed to", and a 404 here would be indistinguishable from a route
     * that does not exist -- which is what this endpoint is fixing.
     */
    getMine: async (req, res) => {
        try {
            const subscription = await subscriptionService.getForUser(callerId(req));

            return res.status(200).json({
                success: true,
                message: subscription
                    ? 'Subscription retrieved'
                    : 'No active subscription',
                data: { subscription }
            });
        } catch (error) {
            return handleError(res, error, 'GET SUBSCRIPTION ERROR');
        }
    },

    /** POST /api/subscriptions/subscribe */
    subscribe: async (req, res) => {
        try {
            const subscription = await subscriptionService.subscribe(
                callerId(req),
                req.body?.planId
            );

            return res.status(201).json({
                success: true,
                message: 'Subscribed successfully',
                data: { subscription },
                // The old handler answered with a bare `periodEnd` at the top
                // level. Kept so an existing caller does not break.
                periodEnd: subscription.currentPeriodEnd
            });
        } catch (error) {
            return handleError(res, error, 'SUBSCRIBE ERROR');
        }
    },

    /** POST /api/subscriptions/pause */
    pause: async (req, res) => {
        try {
            const subscription = await subscriptionService.pause(callerId(req));

            return res.status(200).json({
                success: true,
                message: 'Subscription paused',
                data: { subscription }
            });
        } catch (error) {
            return handleError(res, error, 'PAUSE SUBSCRIPTION ERROR');
        }
    },

    /** POST /api/subscriptions/resume */
    resume: async (req, res) => {
        try {
            const subscription = await subscriptionService.resume(callerId(req));

            return res.status(200).json({
                success: true,
                message: subscription.withdrewCancellation
                    ? 'Subscription resumed and the pending cancellation withdrawn'
                    : 'Subscription resumed',
                data: { subscription }
            });
        } catch (error) {
            return handleError(res, error, 'RESUME SUBSCRIPTION ERROR');
        }
    },

    /** POST /api/subscriptions/cancel */
    cancel: async (req, res) => {
        try {
            const subscription = await subscriptionService.cancel(callerId(req));

            return res.status(200).json({
                success: true,
                // Says when, which the old message did not -- and until the
                // renewal job was fixed there was no "end of the billing
                // period" at all, because nothing ever ended one.
                message:
                    'Subscription will end at the close of the current billing period',
                data: { subscription }
            });
        } catch (error) {
            return handleError(res, error, 'CANCEL SUBSCRIPTION ERROR');
        }
    }
};

module.exports = subscriptionController;
