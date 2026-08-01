// backend/routes/addressRoutes.js
//
// Saved address book (#1347). Mounted at /api/addresses.
//
// Every route is authenticated. There is no guest surface here by design:
// guest checkout keeps working through the manual form on the checkout page,
// which needs no account and therefore no address book.

const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const { addressValidatorMiddleware } = require('../validators/addressValidator');
const { requireOwnership, ownerFromTable } = require('../middleware/requireOwnership');
const {
    listAddresses,
    getAddress,
    getDefaultAddress,
    createAddress,
    updateAddress,
    setDefaultAddress,
    deleteAddress
} = require('../controllers/addressController');

// Applied once rather than repeated per route: a route added later without the
// guard would be an unauthenticated window onto somebody's home address, and
// that is not a mistake worth leaving available.
router.use(authMiddleware);

// Staff get no bypass here. addressService already scopes every statement to
// the owning account, and a support agent reading a customer's home address
// out of a ticket is exactly the access this book was not built to grant.
const ownsAddress = requireOwnership(ownerFromTable({ table: 'user_addresses' }), {
    resourceName: 'Address',
    allowPrivileged: false
});

/**
 * GET /api/addresses
 * Every saved address for the current user, default first.
 */
router.get('/', listAddresses);

/**
 * GET /api/addresses/default
 * The address checkout should prefill with.
 *
 * MUST stay above `/:id` -- Express matches in declaration order, so the
 * parameterised route would otherwise capture "default" as an id and return a
 * 404 for a request that is perfectly valid.
 */
router.get('/default', getDefaultAddress);

/**
 * GET /api/addresses/:id
 */
router.get('/:id', ownsAddress, getAddress);

/**
 * POST /api/addresses
 * Body: { label?, recipientName, recipientPhone, addressLine1, addressLine2?,
 *         landmark?, city, state, postalCode, country?, isDefault? }
 */
router.post('/', addressValidatorMiddleware(), createAddress);

/**
 * PUT /api/addresses/:id
 *
 * Partial by design: `{ partial: true }` means an absent field is left alone
 * rather than treated as a missing required value, so a client can change one
 * field without resending the whole address.
 */
router.put('/:id', ownsAddress, addressValidatorMiddleware({ partial: true }), updateAddress);

/**
 * PATCH /api/addresses/:id/default
 * Promote this address to the account default.
 */
router.patch('/:id/default', ownsAddress, setDefaultAddress);

/**
 * DELETE /api/addresses/:id
 * Soft delete; promotes a survivor if this was the default.
 */
router.delete('/:id', ownsAddress, deleteAddress);

module.exports = router;
