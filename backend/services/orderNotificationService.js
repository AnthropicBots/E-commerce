// backend/services/orderNotificationService.js
//
// The caller emailService has been waiting for (#1698).
//
// #1668 shipped `sendOrderEmail`, an HTML template, an admin log viewer, a
// robots.txt entry and a vercel.json header rule -- and nothing that called any
// of it. `grep -rn sendOrderEmail backend` returned the definition, the export
// and one unit test. No shopper has ever received a confirmation.
//
// This module is the seam between the order flow and the mail transport. It
// exists rather than the controller calling `sendOrderEmail` directly for two
// reasons:
//
//   1. `createOrderService` returns a result shaped for the HTTP response --
//      `orderId`, `breakdown`, `items` -- and `sendOrderEmail` reads a shape
//      built for the template -- `orderNumber`, `subtotal`, `shippingAddress`.
//      Somewhere has to translate, and doing it inline in two call sites is how
//      the two drift.
//   2. Dispatch has to be non-blocking and non-throwing, and that is a property
//      worth stating once, in a place a test can point at.
//
// ORDERING: the caller invokes this AFTER `connection.commit()`. An email is
// not transactional -- there is no un-sending it -- so sending inside the
// transaction risks telling a customer about an order that then rolls back,
// which is strictly worse than a missing email. Committing first means the
// worst case is an order that exists with no confirmation, which the admin
// email log makes visible and an operator can resend.

'use strict';

const emailService = require('./emailService');
const logger = require('../utils/logger');
const { safeArray, safeNumber, sanitizeString } = require('../utils/helpers');

/**
 * Turn a `createOrderService` result into the shape `sendOrderEmail` reads.
 *
 * Every field is resolved from the breakdown first and the top-level result
 * second. The breakdown is what the pricing engine actually charged; the
 * top-level fields are conveniences copied out of it, and a template that
 * quotes a different number from the one on the invoice is a support ticket.
 *
 * @param {Object} params
 * @param {Object} params.result - Return value of `createOrderService`.
 * @param {Object} [params.customer] - `{ name, email, phone }` as submitted.
 * @param {Object} [params.address] - `{ fullAddress, city, state, zip }`.
 * @param {string} [params.paymentMethod] - Canonical payment method.
 * @returns {Object} Payload for `emailService.sendOrderEmail`.
 */
function buildOrderEmailPayload({ result, customer = {}, address = {}, paymentMethod = null }) {
    const breakdown = result?.breakdown || {};

    return {
        id: result?.orderId || null,
        orderId: result?.orderId || null,
        orderNumber: result?.orderNumber || null,
        createdAt: new Date().toISOString(),

        customerName: sanitizeString(customer.name || ''),
        email: sanitizeString(customer.email || ''),

        paymentMethod: paymentMethod ? sanitizeString(paymentMethod) : null,

        subtotal: safeNumber(breakdown.subtotal ?? result?.subtotal, 0),
        discount: safeNumber(breakdown.discount ?? result?.discountAmount, 0),
        tax: safeNumber(breakdown.tax, 0),
        shipping: safeNumber(breakdown.shipping, 0),
        total: safeNumber(breakdown.total ?? result?.total, 0),

        // The order lines as priced, not as submitted. `validatedItems` carries
        // the price the order was actually written with; the cart's copy may be
        // stale, and a confirmation quoting the stale one is the wrong number
        // in writing.
        items: safeArray(result?.items).map((item) => ({
            name: item.name,
            qty: safeNumber(item.qty, 1),
            price: safeNumber(item.price, 0),
            color: item.color || null,
            size: item.size || null
        })),

        shippingAddress: {
            fullName: sanitizeString(customer.name || ''),
            street: sanitizeString(address.fullAddress || ''),
            city: sanitizeString(address.city || ''),
            state: sanitizeString(address.state || ''),
            zip: sanitizeString(address.zip || '')
        }
    };
}

/**
 * Send the order confirmation, without ever failing the order.
 *
 * Returns a promise that always resolves. A checkout that has committed is
 * done: the customer has been charged, stock has moved and the cart is closed.
 * Throwing out of here -- an SMTP timeout, a DNS failure, a template that will
 * not read -- would turn a completed order into a 500 and invite the shopper to
 * pay twice. The failure is logged instead, and `recordEmailLog` leaves the
 * trail an operator needs to resend.
 *
 * @param {Object} params - See `buildOrderEmailPayload`.
 * @returns {Promise<{success: boolean, reason?: string, channel?: string}>}
 */
async function dispatchOrderConfirmation(params) {
    const recipient = sanitizeString(params?.customer?.email || '').trim();

    if (!recipient) {
        // A guest checkout without an email is refused upstream, so this is a
        // shape problem rather than a shopper problem -- worth a line in the
        // log, not worth an exception.
        logger.warn('Order confirmation skipped: no recipient', {
            orderId: params?.result?.orderId || null
        });
        return { success: false, reason: 'missing_recipient' };
    }

    try {
        const payload = buildOrderEmailPayload(params);
        const outcome = await emailService.sendOrderEmail(recipient, payload);

        logger.info('Order confirmation dispatched', {
            orderId: payload.orderId,
            orderNumber: payload.orderNumber,
            channel: outcome?.channel || 'unknown',
            delivered: Boolean(outcome?.delivered)
        });

        return outcome;
    } catch (error) {
        logger.error('Order confirmation failed', {
            orderId: params?.result?.orderId || null,
            error: error.message
        });

        return { success: false, reason: 'send_failed' };
    }
}

module.exports = {
    buildOrderEmailPayload,
    dispatchOrderConfirmation
};
