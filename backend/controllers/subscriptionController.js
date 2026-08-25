// backend/controllers/subscriptionController.js
//
// Thin controllers handling HTTP request/response lifecycles for subscriptions,
// leveraging subscriptionService for business logic and database operations.

'use strict';

const subscriptionService = require('../services/subscriptionService');
const { SubscriptionError } = require('../services/subscriptionService');

/**
 * Maps a thrown error onto an appropriate HTTP response.
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

/** Extracts the caller's unique ID from the authenticated request object. */
function callerId(req) {
    return req.user && (req.user.id || req.user.userId);
}

const subscriptionController = {
    /**
     * GET /api/subscriptions/plans
     * Retrieves all active billing plans.
     */
    listPlans: async (req, res) => {
        try {
            const plans = await subscriptionService.listPlans();

            return res.status(200).json({
                success: true,
                message: 'Billing plans retrieved successfully',
                data: { plans }
            });
        } catch (error) {
            return handleError(res, error, 'LIST BILLING PLANS ERROR');
        }
    },

    /**
     * GET /api/subscriptions/me
     * Retrieves the caller's active subscription, or null if none exists.
     */
    getMine: async (req, res) => {
        try {
            const subscription = await subscriptionService.getForUser(callerId(req));

            return res.status(200).json({
                success: true,
                message: subscription
                    ? 'Subscription retrieved successfully'
                    : 'No active subscription found',
                data: { subscription }
            });
        } catch (error) {
            return handleError(res, error, 'GET SUBSCRIPTION ERROR');
        }
    },

    /**
     * POST /api/subscriptions/subscribe
     * Subscribes the caller to a selected billing plan.
     */
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
                periodEnd: subscription.currentPeriodEnd
            });
        } catch (error) {
            return handleError(res, error, 'SUBSCRIBE ERROR');
        }
    },

    /**
     * POST /api/subscriptions/pause
     * Pauses the caller's active subscription.
     */
    pause: async (req, res) => {
        try {
            const subscription = await subscriptionService.pause(callerId(req));

            return res.status(200).json({
                success: true,
                message: 'Subscription paused successfully',
                data: { subscription }
            });
        } catch (error) {
            return handleError(res, error, 'PAUSE SUBSCRIPTION ERROR');
        }
    },

    /**
     * POST /api/subscriptions/resume
     * Resumes a paused subscription or withdraws a pending cancellation.
     */
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

    /**
     * POST /api/subscriptions/cancel
     * Schedules a subscription for cancellation at the end of the current period.
     */
    cancel: async (req, res) => {
        try {
            const subscription = await subscriptionService.cancel(callerId(req));

            return res.status(200).json({
                success: true,
                message: 'Subscription will end at the close of the current billing period',
                data: { subscription }
            });
        } catch (error) {
            return handleError(res, error, 'CANCEL SUBSCRIPTION ERROR');
        }
    }
};

module.exports = subscriptionController;
