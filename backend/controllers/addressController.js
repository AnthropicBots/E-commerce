// backend/controllers/addressController.js
//
// HTTP surface for the saved address book (#1347).
//
// Thin by design: every multi-row rule (default promotion, delete-and-promote,
// the per-user cap) lives in addressService, because each needs a transaction.
// What is here is the request/response contract.

const addressService = require('../services/addressService');
const { AddressError } = require('../services/addressService');
const { SUGGESTED_LABELS } = require('../validators/addressValidator');

/**
 * The authenticated user's id.
 *
 * authMiddleware attaches the decoded token, which carries `id` on some paths
 * and `userId` on others; rbacMiddleware later replaces it with a full User
 * model. Every handler resolves through here rather than reaching for one
 * shape and silently getting `undefined` on the other -- an `undefined` user id
 * in a `WHERE user_id = ?` matches nothing, which looks exactly like an empty
 * address book.
 */
function resolveUserId(req) {
    return req.user?.id ?? req.user?.userId;
}

/**
 * Map a thrown error onto a response.
 *
 * AddressError carries its own status. Anything else is genuinely unexpected,
 * so it is logged in full and reported as a 500 with a generic message -- a
 * database error string in a response body is an information leak (#1076).
 */
function handleError(res, error, context) {
    if (error instanceof AddressError) {
        return res.status(error.status).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }

    console.error(`${context}:`, error);

    return res.status(500).json({
        success: false,
        error: 'Something went wrong handling your addresses. Please try again.'
    });
}

/**
 * GET /api/addresses
 *
 * Every saved address, default first. Also returns the label suggestions so the
 * client does not hardcode its own copy of the list.
 */
const listAddresses = async (req, res) => {
    try {
        const userId = resolveUserId(req);
        const addresses = await addressService.listAddresses(userId);

        return res.json({
            success: true,
            data: {
                addresses,
                count: addresses.length,
                defaultAddressId: addresses.find((a) => a.isDefault)?.id || null,
                suggestedLabels: SUGGESTED_LABELS
            }
        });
    } catch (error) {
        return handleError(res, error, 'List addresses error');
    }
};

/**
 * GET /api/addresses/default
 *
 * The one address checkout should prefill with. Declared before `/:id` in the
 * router so "default" is not swallowed as an id.
 */
const getDefaultAddress = async (req, res) => {
    try {
        const address = await addressService.getDefaultAddress(resolveUserId(req));

        return res.json({ success: true, data: address });
    } catch (error) {
        return handleError(res, error, 'Get default address error');
    }
};

/**
 * GET /api/addresses/:id
 *
 * 404 rather than 403 for an address belonging to somebody else: a 403 confirms
 * the id exists, and these ids point at where people live.
 */
const getAddress = async (req, res) => {
    try {
        const address = await addressService.getAddress(resolveUserId(req), req.params.id);

        if (!address) {
            return res.status(404).json({ success: false, error: 'Address not found' });
        }

        return res.json({ success: true, data: address });
    } catch (error) {
        return handleError(res, error, 'Get address error');
    }
};

/**
 * POST /api/addresses
 *
 * Body has already been validated and normalised by addressValidatorMiddleware.
 * The first address a user saves becomes their default regardless of what they
 * asked for; the service owns that rule.
 */
const createAddress = async (req, res) => {
    try {
        const address = await addressService.createAddress(resolveUserId(req), req.body);

        return res.status(201).json({
            success: true,
            data: address,
            message: address.isDefault
                ? 'Address saved and set as your default.'
                : 'Address saved.'
        });
    } catch (error) {
        return handleError(res, error, 'Create address error');
    }
};

/**
 * PUT /api/addresses/:id
 *
 * Partial: only the fields present in the body are written, so a client
 * changing a label does not blank the recipient.
 */
const updateAddress = async (req, res) => {
    try {
        const address = await addressService.updateAddress(
            resolveUserId(req),
            req.params.id,
            req.body
        );

        return res.json({ success: true, data: address, message: 'Address updated.' });
    } catch (error) {
        return handleError(res, error, 'Update address error');
    }
};

/**
 * PATCH /api/addresses/:id/default
 *
 * Its own endpoint rather than a flag on update: promoting a default is a
 * two-row operation with its own invariant, and separating it means a client
 * cannot half-express the intent by sending `isDefault` alongside a typo'd city.
 */
const setDefaultAddress = async (req, res) => {
    try {
        const address = await addressService.setDefaultAddress(
            resolveUserId(req),
            req.params.id
        );

        return res.json({
            success: true,
            data: address,
            message: 'Default address updated.'
        });
    } catch (error) {
        return handleError(res, error, 'Set default address error');
    }
};

/**
 * DELETE /api/addresses/:id
 *
 * Soft delete. Returns the promoted address when the deleted one was the
 * default, so the client can update its picker without a refetch.
 */
const deleteAddress = async (req, res) => {
    try {
        const result = await addressService.deleteAddress(resolveUserId(req), req.params.id);

        return res.json({
            success: true,
            data: result,
            message: result.newDefaultId
                ? 'Address removed. Your next address is now the default.'
                : 'Address removed.'
        });
    } catch (error) {
        return handleError(res, error, 'Delete address error');
    }
};

module.exports = {
    listAddresses,
    getAddress,
    getDefaultAddress,
    createAddress,
    updateAddress,
    setDefaultAddress,
    deleteAddress
};
