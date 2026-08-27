'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const { safeNumber, safeArray, sanitizeString, escapeHTML } = require('../utils/helpers');

// Ring buffer for in-memory email logs (troubleshooting & fallback)
const MAX_LOG_ENTRIES = 100;
const emailLogBuffer = [];

/**
 * Record an email log entry in memory and optionally DB.
 */
async function recordEmailLog(entry) {
    const logItem = {
        id: entry.id || `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        recipient: entry.recipient,
        subject: entry.subject,
        orderId: entry.orderId || null,
        orderNumber: entry.orderNumber || null,
        status: entry.status || 'sent',
        channel: entry.channel || 'log',
        sentAt: entry.sentAt || new Date().toISOString(),
        error: entry.error || null
    };

    emailLogBuffer.unshift(logItem);
    if (emailLogBuffer.length > MAX_LOG_ENTRIES) {
        emailLogBuffer.pop();
    }

    try {
        await db.query(
            `INSERT INTO email_logs (recipient, subject, order_id, status, channel, error)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [logItem.recipient, logItem.subject, logItem.orderId, logItem.status, logItem.channel, logItem.error]
        ).catch(() => {}); // Table created dynamically if needed
    } catch (_) {
        // DB log failure is non-blocking
    }

    return logItem;
}

/**
 * Get recent email logs for admin UI.
 *
 * @param {number} [limit=50]
 * @returns {Promise<Array<Object>>}
 */
async function getEmailLogs(limit = 50) {
    const fetchLimit = Math.max(1, Math.min(100, Number(limit) || 50));

    try {
        const [rows] = await db.query(
            `SELECT id, recipient, subject, order_id AS orderId, status, channel, sent_at AS sentAt, error
               FROM email_logs
              ORDER BY sent_at DESC
              LIMIT ?`,
            [fetchLimit]
        );

        if (rows && rows.length > 0) {
            return rows;
        }
    } catch (_) {
        // Fall back to memory buffer if table is missing
    }

    return emailLogBuffer.slice(0, fetchLimit);
}

/**
 * Format currency price with ₹ symbol.
 */
function formatPrice(amount) {
    const val = safeNumber(amount, 0);
    return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Build HTML table rows for order items.
 */
function buildItemsTableRows(items) {
    const list = safeArray(items);
    if (!list.length) {
        return '<tr><td colspan="3" style="padding: 12px 0; color: #64748b; text-align: center;">No item details available</td></tr>';
    }

    return list.map((item) => {
        const name = escapeHTML(sanitizeString(item.name || item.title || 'Product'));
        const qty = safeNumber(item.qty || item.quantity, 1);
        const price = safeNumber(item.price || item.unitPrice, 0);
        const lineTotal = price * qty;
        const color = item.color ? `Color: ${escapeHTML(sanitizeString(item.color))}` : '';
        const size = item.size ? `Size: ${escapeHTML(sanitizeString(item.size))}` : '';
        const details = [color, size].filter(Boolean).join(' | ');

        return `
            <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 12px 0;">
                    <div style="font-weight: 600; color: #0f172a; font-size: 14px;">${name}</div>
                    ${details ? `<div style="font-size: 12px; color: #64748b; margin-top: 2px;">${details}</div>` : ''}
                </td>
                <td style="padding: 12px 0; font-size: 14px; color: #334155; text-align: center;">${qty}</td>
                <td style="padding: 12px 0; font-size: 14px; font-weight: 600; color: #0f172a; text-align: right;">${formatPrice(lineTotal)}</td>
            </tr>
        `;
    }).join('');
}

/**
 * Send HTML order confirmation email to the customer.
 *
 * @param {string} toEmail - Recipient email address.
 * @param {Object} order - Created order data.
 * @returns {Promise<Object>} Delivery result.
 */
async function sendOrderEmail(toEmail, order) {
    const recipient = sanitizeString(toEmail || order?.email || order?.user_email || '').trim();
    if (!recipient) {
        console.warn('[emailService] Skipping sendOrderEmail: No recipient email provided');
        return { success: false, reason: 'missing_recipient' };
    }

    const rawOrderNumber = order.orderNumber || order.order_number || order.id || 'N/A';
    const orderNumber = escapeHTML(sanitizeString(rawOrderNumber));
    const orderId = order.id || order.orderId || null;
    const customerName = escapeHTML(sanitizeString(order.customerName || order.shippingAddress?.fullName || order.fullName || recipient.split('@')[0]));
    const orderDate = new Date(order.created_at || order.createdAt || Date.now()).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    const subtotalVal = safeNumber(order.subtotal, 0);
    const discountVal = safeNumber(order.discount || order.discount_amount, 0);
    const taxVal = safeNumber(order.tax || order.tax_amount, 0);
    const shippingVal = safeNumber(order.shipping || order.shipping_cost, 0);
    const totalVal = safeNumber(order.total || order.total_amount, 0);

    const itemsTableRows = buildItemsTableRows(order.items || order.lines);

    const addressObj = order.shippingAddress || order.address || {};
    const street = addressObj.street || addressObj.address || '';
    const city = addressObj.city || '';
    const state = addressObj.state || '';
    const zip = addressObj.zip || addressObj.pincode || '';
    const shippingAddressStr = escapeHTML([street, city, state, zip].filter(Boolean).join(', ') || 'Standard Delivery');

    const paymentMethod = escapeHTML(sanitizeString(order.paymentMethod || 'Online Payment'));

    const discountRowHtml = discountVal > 0 ? `
        <tr>
            <td style="color: #16a34a; font-size: 14px; padding: 4px 0;">Discount</td>
            <td style="color: #16a34a; font-size: 14px; font-weight: 500; text-align: right; padding: 4px 0;">-${formatPrice(discountVal)}</td>
        </tr>
    ` : '';

    // Load template file
    let templateHtml = '';
    try {
        const templatePath = path.join(__dirname, '../templates/order-confirmation.html');
        templateHtml = fs.readFileSync(templatePath, 'utf8');
    } catch (err) {
        console.error('[emailService] Template load error:', err.message);
        templateHtml = `<h2>Order Confirmation</h2><p>Order #{{orderNumber}} total: {{total}}</p>`;
    }

    // Populate placeholders
    const htmlBody = templateHtml
        .replace(/{{customerName}}/g, customerName)
        .replace(/{{orderNumber}}/g, orderNumber)
        .replace(/{{orderDate}}/g, orderDate)
        .replace(/{{customerEmail}}/g, escapeHTML(recipient))
        .replace(/{{paymentMethod}}/g, paymentMethod)
        .replace(/{{itemsTableRows}}/g, itemsTableRows)
        .replace(/{{subtotal}}/g, formatPrice(subtotalVal))
        .replace(/{{discountRow}}/g, discountRowHtml)
        .replace(/{{tax}}/g, formatPrice(taxVal))
        .replace(/{{shipping}}/g, shippingVal === 0 ? 'Free' : formatPrice(shippingVal))
        .replace(/{{total}}/g, formatPrice(totalVal))
        .replace(/{{shippingAddress}}/g, shippingAddressStr);

    const subject = `Order Confirmation #${orderNumber} - AnthropicBots E-Commerce`;

    // Transport configuration
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
        try {
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host,
                port: Number(process.env.SMTP_PORT) || 587,
                secure: process.env.SMTP_SECURE === 'true',
                auth: { user, pass }
            });

            const info = await transporter.sendMail({
                from: process.env.SMTP_FROM || `"AnthropicBots E-Commerce" <${user}>`,
                to: recipient,
                subject,
                html: htmlBody
            });

            await recordEmailLog({
                recipient,
                subject,
                orderId,
                orderNumber,
                status: 'sent',
                channel: 'smtp'
            });

            console.info(`[emailService] Email sent via SMTP to ${recipient} (messageId: ${info.messageId})`);
            return { success: true, delivered: true, channel: 'smtp', messageId: info.messageId };
        } catch (error) {
            console.error('[emailService] SMTP send error:', error.message);
            await recordEmailLog({
                recipient,
                subject,
                orderId,
                orderNumber,
                status: 'failed',
                channel: 'smtp',
                error: error.message
            });
        }
    }

    // Fallback: log email when SMTP is unconfigured
    console.info(`[emailService] Order confirmation email logged (SMTP not configured) for ${recipient} (Order #${orderNumber})`);

    await recordEmailLog({
        recipient,
        subject,
        orderId,
        orderNumber,
        status: 'logged',
        channel: 'log'
    });

    return { success: true, delivered: false, channel: 'log', html: htmlBody };
}

module.exports = {
    sendOrderEmail,
    getEmailLogs,
    recordEmailLog,
    buildItemsTableRows
};
