/**
 * Wishlist → Price-Drop Notification Worker helpers (#1394).
 *
 * - Syncs baselines from wishlist_items + live product prices
 * - Detects price drops vs baseline / last notified price
 * - Publishes via notificationBroker (email + in-app)
 * - Respects per-user preference center + signed unsubscribe tokens
 * - Daily dedupe so the same SKU cannot spam a user more than once per day
 */

"use strict";

const crypto = require("crypto");
const db = require("../config/db");
const {
    notificationBroker,
    NOTIFICATION_TYPES
} = require("./notificationBrokerService");

const UNSUBSCRIBE_SECRET =
    process.env.PRICE_DROP_UNSUB_SECRET ||
    process.env.JWT_SECRET ||
    "price-drop-unsub-dev-secret";

const MIN_DROP_PERCENT = Math.max(
    0,
    Number(process.env.PRICE_DROP_MIN_PERCENT) || 1
);

function sha256(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function mintRawToken() {
    return crypto.randomBytes(32).toString("hex");
}

function dayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function dedupeKey(userId, productId, day = dayKey()) {
    return `${userId}:${productId}:${day}`;
}

function signUnsubscribeToken(userId, rawToken) {
    // token format: userId.raw.hmac — verifiable without a DB round-trip,
    // while the hash in notification_preferences still gates reuse after rotate.
    const body = `${userId}.${rawToken}`;
    const sig = crypto
        .createHmac("sha256", UNSUBSCRIBE_SECRET)
        .update(body)
        .digest("hex");
    return `${body}.${sig}`;
}

function parseUnsubscribeToken(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const [userId, rawToken, sig] = parts;
    const body = `${userId}.${rawToken}`;
    const expected = crypto
        .createHmac("sha256", UNSUBSCRIBE_SECRET)
        .update(body)
        .digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return null;
    }
    return { userId, rawToken, hash: sha256(rawToken) };
}

async function ensurePreferences(userId) {
    const [rows] = await db.query(
        `SELECT * FROM notification_preferences WHERE user_id = ? LIMIT 1`,
        [userId]
    );
    if (rows[0]) {
        return { prefs: rows[0], rawToken: null };
    }

    const rawToken = mintRawToken();
    await db.query(
        `INSERT INTO notification_preferences
            (user_id, price_drop_email, price_drop_in_app, unsubscribed_all, unsubscribe_token_hash)
         VALUES (?, 1, 1, 0, ?)`,
        [userId, sha256(rawToken)]
    );
    const [created] = await db.query(
        `SELECT * FROM notification_preferences WHERE user_id = ? LIMIT 1`,
        [userId]
    );
    return { prefs: created[0], rawToken };
}

async function getPreferences(userId) {
    const { prefs, rawToken } = await ensurePreferences(userId);
    const unsubscribeToken =
        rawToken
            ? signUnsubscribeToken(userId, rawToken)
            : null;

    return {
        userId,
        priceDropEmail: Boolean(prefs.price_drop_email),
        priceDropInApp: Boolean(prefs.price_drop_in_app),
        unsubscribedAll: Boolean(prefs.unsubscribed_all),
        // Fresh token when prefs were just created; otherwise a stable signed link.
        unsubscribeToken:
            rawToken
                ? signUnsubscribeToken(userId, rawToken)
                : buildStableUnsubscribeToken(userId),
        unsubscribeUrl: buildUnsubscribeUrl(
            rawToken
                ? signUnsubscribeToken(userId, rawToken)
                : buildStableUnsubscribeToken(userId)
        ),
        updatedAt: prefs.updated_at
    };
}

async function updatePreferences(userId, patch = {}) {
    await ensurePreferences(userId);

    const email =
        patch.priceDropEmail === undefined
            ? null
            : patch.priceDropEmail ? 1 : 0;
    const inApp =
        patch.priceDropInApp === undefined
            ? null
            : patch.priceDropInApp ? 1 : 0;
    const unsubAll =
        patch.unsubscribedAll === undefined
            ? null
            : patch.unsubscribedAll ? 1 : 0;

    await db.query(
        `UPDATE notification_preferences SET
            price_drop_email = COALESCE(?, price_drop_email),
            price_drop_in_app = COALESCE(?, price_drop_in_app),
            unsubscribed_all = COALESCE(?, unsubscribed_all),
            updated_at = NOW()
         WHERE user_id = ?`,
        [email, inApp, unsubAll, userId]
    );

    return getPreferences(userId);
}

async function rotateUnsubscribeToken(userId) {
    const rawToken = mintRawToken();
    await ensurePreferences(userId);
    await db.query(
        `UPDATE notification_preferences
         SET unsubscribe_token_hash = ?, updated_at = NOW()
         WHERE user_id = ?`,
        [sha256(rawToken), userId]
    );
    return {
        unsubscribeToken: signUnsubscribeToken(userId, rawToken),
        unsubscribeUrl: buildUnsubscribeUrl(signUnsubscribeToken(userId, rawToken))
    };
}

function buildStableUnsubscribeToken(userId) {
    const sig = crypto
        .createHmac("sha256", UNSUBSCRIBE_SECRET)
        .update(`price-drop-unsub:${userId}`)
        .digest("hex");
    return `${userId}.${sig}`;
}

function parseStableUnsubscribeToken(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) return null;
    const [userId, sig] = parts;
    const expected = crypto
        .createHmac("sha256", UNSUBSCRIBE_SECRET)
        .update(`price-drop-unsub:${userId}`)
        .digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return null;
    }
    return { userId };
}

function buildUnsubscribeUrl(token) {
    const frontend = (process.env.FRONTEND_URL || "http://localhost:5500").replace(/\/$/, "");
    return `${frontend}/dashboard.html?tab=wishlist&unsubscribe=${encodeURIComponent(token)}`;
}

async function unsubscribeWithToken(token) {
    const rotatable = parseUnsubscribeToken(token);
    const stable = rotatable ? null : parseStableUnsubscribeToken(token);

    let userId = null;
    if (rotatable) {
        const [rows] = await db.query(
            `SELECT user_id, unsubscribe_token_hash FROM notification_preferences WHERE user_id = ?`,
            [rotatable.userId]
        );
        if (!rows[0] || rows[0].unsubscribe_token_hash !== rotatable.hash) {
            const err = new Error("Unsubscribe token is expired or already rotated");
            err.status = 410;
            err.code = "UNSUBSCRIBE_TOKEN_STALE";
            throw err;
        }
        userId = rotatable.userId;
    } else if (stable) {
        userId = stable.userId;
    } else {
        const err = new Error("Invalid or tampered unsubscribe link");
        err.status = 400;
        err.code = "INVALID_UNSUBSCRIBE_TOKEN";
        throw err;
    }

    await ensurePreferences(userId);
    await db.query(
        `UPDATE notification_preferences
         SET unsubscribed_all = 1,
             price_drop_email = 0,
             price_drop_in_app = 0,
             updated_at = NOW()
         WHERE user_id = ?`,
        [userId]
    );

    return { userId, unsubscribedAll: true };
}

/**
 * Upsert a baseline when a product is wishlisted (or during sync).
 * Does not lower the baseline on later syncs — only tracks last_seen_price —
 * so a temporary spike does not erase a better historical baseline.
 */
async function upsertBaseline(userId, productId, currentPrice) {
    const price = Number(currentPrice);
    if (!Number.isFinite(price) || price < 0) {
        throw new Error("Invalid product price for baseline");
    }

    await db.query(
        `INSERT INTO price_drop_baselines
            (user_id, product_id, baseline_price, last_seen_price)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            last_seen_price = VALUES(last_seen_price),
            baseline_price = LEAST(baseline_price, VALUES(baseline_price)),
            updated_at = NOW()`,
        [userId, productId, price, price]
    );
}

/**
 * Pull active wishlist rows and ensure every line has a baseline.
 */
async function syncBaselinesFromWishlist() {
    const [rows] = await db.query(
        `SELECT w.user_id, w.product_id, p.price
           FROM wishlist_items w
           JOIN products p ON p.id = w.product_id
          WHERE w.deleted_at IS NULL`
    );

    let synced = 0;
    for (const row of rows) {
        try {
            await upsertBaseline(row.user_id, row.product_id, row.price);
            synced += 1;
        } catch (err) {
            console.error(
                `syncBaselinesFromWishlist failed for ${row.user_id}/${row.product_id}:`,
                err.message
            );
        }
    }
    return { synced, total: rows.length };
}

function channelsForPrefs(prefs) {
    if (!prefs || prefs.unsubscribed_all) return [];
    const channels = [];
    if (prefs.price_drop_in_app) channels.push("in_app");
    if (prefs.price_drop_email) channels.push("email");
    return channels;
}

async function alreadyNotifiedToday(userId, productId) {
    const key = dedupeKey(userId, productId);
    const [rows] = await db.query(
        `SELECT id FROM price_drop_notification_log WHERE dedupe_key = ? LIMIT 1`,
        [key]
    );
    return Boolean(rows[0]);
}

async function recordNotificationLog({
    userId,
    productId,
    oldPrice,
    newPrice,
    channels
}) {
    const key = dedupeKey(userId, productId);
    try {
        await db.query(
            `INSERT INTO price_drop_notification_log
                (user_id, product_id, old_price, new_price, channels_json, dedupe_key)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                userId,
                productId,
                oldPrice,
                newPrice,
                JSON.stringify(channels),
                key
            ]
        );
        return true;
    } catch (err) {
        // Duplicate dedupe_key → already sent today
        if (err && (err.code === "ER_DUP_ENTRY" || /duplicate/i.test(err.message))) {
            return false;
        }
        throw err;
    }
}

async function sendPriceDropEmail({ to, productName, oldPrice, newPrice, unsubscribeUrl }) {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const subject = `Price drop: ${productName}`;
    const text =
        `${productName} dropped from ${oldPrice} to ${newPrice}.\n\n` +
        (unsubscribeUrl
            ? `Manage preferences / unsubscribe: ${unsubscribeUrl}\n`
            : "");

    if (host && user && pass) {
        try {
            const nodemailer = require("nodemailer");
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
            return { delivered: true, channel: "smtp" };
        } catch (err) {
            console.error("Price-drop email failed:", err.message);
        }
    }

    console.info("[price-drop] email (SMTP not configured):", {
        to,
        subject,
        oldPrice,
        newPrice
    });
    return { delivered: false, channel: "log" };
}

/**
 * Core scan: wishlist baselines whose live price fell enough to notify.
 */
async function runPriceDropScan() {
    await syncBaselinesFromWishlist();

    const [candidates] = await db.query(
        `SELECT b.user_id, b.product_id, b.baseline_price, b.last_seen_price,
                b.last_notified_price, b.last_notified_at,
                p.price AS current_price, p.name AS product_name,
                u.email AS user_email, u.name AS user_name,
                pref.price_drop_email, pref.price_drop_in_app, pref.unsubscribed_all,
                pref.unsubscribe_token_hash
           FROM price_drop_baselines b
           JOIN products p ON p.id = b.product_id
           JOIN users u ON u.id = b.user_id
           JOIN wishlist_items w
             ON w.user_id = b.user_id
            AND w.product_id = b.product_id
            AND w.deleted_at IS NULL
           LEFT JOIN notification_preferences pref ON pref.user_id = b.user_id
          WHERE p.price < b.baseline_price
            AND (
                  b.last_notified_price IS NULL
               OR p.price < b.last_notified_price
            )`
    );

    let notified = 0;
    let skipped = 0;

    for (const row of candidates) {
        const current = Number(row.current_price);
        const baseline = Number(row.baseline_price);
        if (!(current < baseline)) {
            skipped += 1;
            continue;
        }

        const dropPct = ((baseline - current) / baseline) * 100;
        if (dropPct < MIN_DROP_PERCENT) {
            skipped += 1;
            continue;
        }

        // Ensure prefs exist for channel resolution / unsubscribe links
        const { prefs } = await ensurePreferences(row.user_id);
        const channels = channelsForPrefs({
            price_drop_email: prefs.price_drop_email,
            price_drop_in_app: prefs.price_drop_in_app,
            unsubscribed_all: prefs.unsubscribed_all
        });

        if (!channels.length) {
            skipped += 1;
            continue;
        }

        if (await alreadyNotifiedToday(row.user_id, row.product_id)) {
            skipped += 1;
            continue;
        }

        const logged = await recordNotificationLog({
            userId: row.user_id,
            productId: row.product_id,
            oldPrice: baseline,
            newPrice: current,
            channels
        });
        if (!logged) {
            skipped += 1;
            continue;
        }

        try {
            await notificationBroker.publish(
                NOTIFICATION_TYPES.WISHLIST_PRICE_DROP,
                {
                    userId: row.user_id,
                    productId: row.product_id,
                    productName: row.product_name,
                    oldPrice: baseline,
                    newPrice: current,
                    dropPercent: Number(dropPct.toFixed(2))
                },
                { channels }
            );

            if (channels.includes("email") && row.user_email) {
                const unsubToken = buildStableUnsubscribeToken(row.user_id);
                await sendPriceDropEmail({
                    to: row.user_email,
                    productName: row.product_name,
                    oldPrice: baseline,
                    newPrice: current,
                    unsubscribeUrl: buildUnsubscribeUrl(unsubToken)
                });
            }

            await db.query(
                `UPDATE price_drop_baselines
                 SET last_seen_price = ?,
                     last_notified_at = NOW(),
                     last_notified_price = ?,
                     updated_at = NOW()
                 WHERE user_id = ? AND product_id = ?`,
                [current, current, row.user_id, row.product_id]
            );

            notified += 1;
        } catch (err) {
            console.error(
                `price-drop notify failed ${row.user_id}/${row.product_id}:`,
                err.message
            );
            // Allow retry tomorrow; dedupe row already written — delete so retry works same day?
            // Keep dedupe to avoid broker storm; next day can fire if price still lower.
        }
    }

    // Refresh last_seen_price for non-drop rows still on wishlist
    await db.query(
        `UPDATE price_drop_baselines b
         JOIN products p ON p.id = b.product_id
         SET b.last_seen_price = p.price, b.updated_at = NOW()`
    );

    return { candidates: candidates.length, notified, skipped };
}

module.exports = {
    getPreferences,
    updatePreferences,
    rotateUnsubscribeToken,
    unsubscribeWithToken,
    upsertBaseline,
    syncBaselinesFromWishlist,
    runPriceDropScan,
    buildUnsubscribeUrl,
    buildStableUnsubscribeToken,
    signUnsubscribeToken,
    parseUnsubscribeToken,
    parseStableUnsubscribeToken,
    dedupeKey,
    channelsForPrefs,
    MIN_DROP_PERCENT,
    // test seams
    _internal: {
        sha256,
        mintRawToken,
        dayKey,
        sendPriceDropEmail
    }
};
