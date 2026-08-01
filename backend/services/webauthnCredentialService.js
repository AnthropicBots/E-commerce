/**
 * WebAuthn credential persistence (#1385).
 */

"use strict";

const crypto = require("crypto");
const db = require("../config/db").promise;
const { isoBase64URL } = require("@simplewebauthn/server/helpers");

function rowToCredential(row) {
    if (!row) return null;
    let transports = null;
    if (row.transports) {
        try {
            transports =
                typeof row.transports === "string"
                    ? JSON.parse(row.transports)
                    : row.transports;
        } catch (_) {
            transports = null;
        }
    }
    return {
        id: row.id,
        userId: row.user_id,
        credentialID: row.credential_id,
        publicKey: isoBase64URL.toBuffer(row.public_key),
        counter: Number(row.counter) || 0,
        deviceName: row.device_name,
        transports: Array.isArray(transports) ? transports : undefined,
        backedUp: Boolean(row.backed_up),
        deviceType: row.device_type,
        aaguid: row.aaguid,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at
    };
}

async function listByUserId(userId) {
    const [rows] = await db.query(
        `SELECT id, user_id, credential_id, public_key, counter, device_name,
                transports, backed_up, device_type, aaguid, created_at, last_used_at
         FROM webauthn_credentials
         WHERE user_id = ?
         ORDER BY created_at DESC`,
        [userId]
    );
    return (rows || []).map(rowToCredential);
}

async function findByCredentialId(credentialId) {
    const [rows] = await db.query(
        `SELECT id, user_id, credential_id, public_key, counter, device_name,
                transports, backed_up, device_type, aaguid, created_at, last_used_at
         FROM webauthn_credentials
         WHERE credential_id = ?
         LIMIT 1`,
        [credentialId]
    );
    return rowToCredential(rows?.[0]);
}

async function createCredential({
    userId,
    credentialId,
    publicKey,
    counter,
    deviceName,
    transports,
    backedUp,
    deviceType,
    aaguid
}) {
    const id = crypto.randomUUID();
    const publicKeyB64 =
        typeof publicKey === "string"
            ? publicKey
            : isoBase64URL.fromBuffer(publicKey);
    const name = String(deviceName || "Passkey").slice(0, 120);
    await db.query(
        `INSERT INTO webauthn_credentials
            (id, user_id, credential_id, public_key, counter, device_name,
             transports, backed_up, device_type, aaguid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            userId,
            credentialId,
            publicKeyB64,
            Number(counter) || 0,
            name,
            transports ? JSON.stringify(transports) : null,
            backedUp ? 1 : 0,
            deviceType || null,
            aaguid || null
        ]
    );
    return findByCredentialId(credentialId);
}

async function updateCounter(credentialId, newCounter) {
    await db.query(
        `UPDATE webauthn_credentials
         SET counter = ?, last_used_at = CURRENT_TIMESTAMP
         WHERE credential_id = ?`,
        [Number(newCounter) || 0, credentialId]
    );
}

async function renameCredential(userId, id, deviceName) {
    const name = String(deviceName || "").trim().slice(0, 120);
    if (!name) return false;
    const [result] = await db.query(
        `UPDATE webauthn_credentials
         SET device_name = ?
         WHERE id = ? AND user_id = ?`,
        [name, id, userId]
    );
    return (result?.affectedRows || 0) > 0;
}

async function deleteCredential(userId, id) {
    const [result] = await db.query(
        `DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?`,
        [id, userId]
    );
    return (result?.affectedRows || 0) > 0;
}

function toPublicListItem(cred) {
    return {
        id: cred.id,
        deviceName: cred.deviceName,
        deviceType: cred.deviceType,
        backedUp: cred.backedUp,
        createdAt: cred.createdAt,
        lastUsedAt: cred.lastUsedAt
    };
}

module.exports = {
    listByUserId,
    findByCredentialId,
    createCredential,
    updateCounter,
    renameCredential,
    deleteCredential,
    toPublicListItem,
    rowToCredential
};
