/**
 * One-way channel from the code that ends a session to whatever is holding live
 * connections for it.
 *
 * Sessions are ended in the service layer, which is reached from ordinary HTTP
 * requests and has to stay loadable in a process that serves nothing else. The
 * realtime layer subscribes here when it starts, so the service layer never
 * imports Socket.IO and a process without a realtime layer simply has no
 * subscriber -- announcing a revocation is then a no-op rather than a crash.
 *
 * @module utils/sessionRevocationBus
 */

const { EventEmitter } = require("events");

const SESSION_REVOKED_EVENT = "session_revoked";

// One subscriber is expected. The default ceiling would hide a module that
// re-subscribes on every initialisation, so it is lowered rather than raised.
const bus = new EventEmitter();
bus.setMaxListeners(4);

/**
 * Announce that sessions have been ended.
 *
 * `sessionId`, `familyId` and `userId` describe the same revocation at
 * decreasing precision; a caller supplies the narrowest one it knows and a
 * subscriber acts on the narrowest one present.
 *
 * A subscriber must not be able to fail the revocation that triggered it: the
 * database write has already happened by the time this is called, and the
 * caller is in the middle of a sign-out.
 *
 * @param {Object} target
 * @param {string} [target.sessionId] - A single session.
 * @param {string} [target.familyId] - Every session descended from one sign-in.
 * @param {string|number} [target.userId] - Every session on the account.
 * @param {string} [target.exceptSessionId] - Session to spare; only meaningful
 *   alongside `userId`.
 * @param {string} [target.reason]
 */
function publishSessionRevoked(target) {
    if (!target) return;

    try {
        bus.emit(SESSION_REVOKED_EVENT, target);
    } catch (error) {
        console.warn("Session revocation subscriber failed:", error.message);
    }
}

/**
 * @param {Function} handler - Receives the target of every revocation.
 * @returns {Function} Removes this subscription.
 */
function onSessionRevoked(handler) {
    bus.on(SESSION_REVOKED_EVENT, handler);
    return () => bus.off(SESSION_REVOKED_EVENT, handler);
}

module.exports = {
    SESSION_REVOKED_EVENT,
    onSessionRevoked,
    publishSessionRevoked
};
