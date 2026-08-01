// backend/services/notificationEmailService.js
//
// One way out of the building for notification mail.
//
// The price-drop worker (#1394) carried its own copy of "configure a
// transport, send, and fall back to a log line when SMTP is not set up". A
// second notification programme copying the same block is how deployments end
// up with two senders that disagree about which environment variables matter
// and whether a missing transport is an error or a no-op.
//
// Delivery is deliberately best-effort. A store with no SMTP credentials --
// every local checkout, and CI -- still has to be able to run the workers, so
// an unconfigured transport writes the message where a developer can see it
// and reports honestly that nothing was delivered. What is *not* best-effort
// is the send log: callers record the send first, so a transport failure loses
// one message rather than freeing the sender to try again forever.

'use strict';

/**
 * Send a plain-text notification email, or log it when SMTP is unconfigured.
 *
 * @param {object} message
 * @param {string} message.to
 * @param {string} message.subject
 * @param {string} message.text
 * @returns {Promise<{delivered: boolean, channel: 'smtp'|'log'}>}
 */
async function sendNotificationEmail({ to, subject, text }) {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
        try {
            const nodemailer = require('nodemailer');
            const transporter = nodemailer.createTransport({
                host,
                port: Number(process.env.SMTP_PORT) || 587,
                secure: false,
                auth: { user, pass }
            });

            await transporter.sendMail({
                from: process.env.SMTP_FROM || user,
                to,
                subject,
                text
            });

            return { delivered: true, channel: 'smtp' };
        } catch (error) {
            console.error('Notification email failed:', error.message);
        }
    }

    console.info('[notification] email (SMTP not configured):', { to, subject });

    return { delivered: false, channel: 'log' };
}

module.exports = { sendNotificationEmail };
