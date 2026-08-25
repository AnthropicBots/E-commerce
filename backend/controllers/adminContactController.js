// backend/controllers/adminContactController.js
//
// The read side of the contact form (#1495).
//
// `POST /api/contact` has been writing to `contact_messages` since #1445 and
// nothing has ever read the table. Not badly -- at all: there was no SELECT
// against it anywhere in the repository, no admin route and no screen. Every
// message anyone sent through the site went into a table no human being and no
// piece of code could open, behind a toast promising a reply by email.
//
// These handlers are thin. Everything that decides anything is in
// contactService, beside the writer, so validation, insertion and retrieval
// cannot get different answers to "what is a valid status?".

'use strict';

const contactService = require('../services/contactService');
const { ContactError } = require('../services/contactService');

/**
 * Map a thrown error onto a response.
 *
 * @param {import('express').Response} res
 * @param {Error} error
 * @param {string} context
 */
function handleError(res, error, context) {
    if (error instanceof ContactError) {
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
function actorId(req) {
    return req.user && (req.user.id || req.user.userId);
}

/**
 * GET /api/admin/contact-messages
 *
 * Query: ?status=new&search=refund&email=a@b.c&page=1&limit=20
 *
 * Oldest first within a filter. A support queue read newest-first buries the
 * complaint that has been waiting longest, which is the one that matters.
 */
const listContactMessages = async (req, res) => {
    try {
        const result = await contactService.listMessages({
            status: req.query.status,
            search: req.query.search,
            email: req.query.email,
            page: req.query.page,
            limit: req.query.limit
        });

        return res.status(200).json({
            success: true,
            message: 'Contact messages retrieved',
            data: result
        });
    } catch (error) {
        return handleError(res, error, 'LIST CONTACT MESSAGES ERROR');
    }
};

/**
 * GET /api/admin/contact-messages/:id
 *
 * One message, plus everything else that address has ever sent. Answering the
 * fourth complaint from someone without knowing it is the fourth is how a
 * support queue loses people.
 */
const getContactMessage = async (req, res) => {
    try {
        const message = await contactService.getMessage(req.params.id);

        return res.status(200).json({
            success: true,
            message: 'Contact message retrieved',
            data: { message }
        });
    } catch (error) {
        return handleError(res, error, 'GET CONTACT MESSAGE ERROR');
    }
};

/**
 * PATCH /api/admin/contact-messages/:id/status
 *
 * Body: { status: 'new' | 'in_progress' | 'resolved' | 'spam' }
 *
 * Closing one stamps `responded_at` and `responded_by`. Those columns have
 * existed since migration 0042 with no writer at all.
 */
const updateContactMessageStatus = async (req, res) => {
    try {
        const message = await contactService.updateStatus(
            req.params.id,
            req.body?.status,
            actorId(req)
        );

        return res.status(200).json({
            success: true,
            message: `Message marked ${message.status}`,
            data: { message }
        });
    } catch (error) {
        return handleError(res, error, 'UPDATE CONTACT MESSAGE STATUS ERROR');
    }
};

/**
 * GET /api/admin/contact-messages/summary
 *
 * How many are sitting in each state. A dashboard leads with "how many are
 * unanswered" and that number cannot be derived from a paginated list.
 */
const getContactMessageSummary = async (req, res) => {
    try {
        const counts = await contactService.countByStatus();

        return res.status(200).json({
            success: true,
            message: 'Contact message summary retrieved',
            data: { counts }
        });
    } catch (error) {
        return handleError(res, error, 'CONTACT MESSAGE SUMMARY ERROR');
    }
};

module.exports = {
    listContactMessages,
    getContactMessage,
    updateContactMessageStatus,
    getContactMessageSummary
};
