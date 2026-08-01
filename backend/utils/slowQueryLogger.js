/**
 * Slow-query logging with sanitized SQL and route attribution (#1391).
 */

"use strict";

const logger = require("./logger");

/**
 * Strip literals / long digit runs so logs never leak PII from VALUES (...).
 */
function sanitizeSql(sql) {
    if (sql == null) {
        return "unknown";
    }
    let text = String(sql);
    // Quoted strings (single / double)
    text = text.replace(/'(?:''|[^'])*'/g, "'?'");
    text = text.replace(/"(?:\\"|[^"])*"/g, '"?"');
    // Hex / binary blobs
    text = text.replace(/\b0x[0-9a-fA-F]+\b/g, "0x?");
    // Long numeric literals (keep short ones like LIMIT 10)
    text = text.replace(/\b\d{6,}\b/g, "?");
    // Collapse whitespace
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > 400) {
        text = `${text.slice(0, 400)}…`;
    }
    return text;
}

/**
 * @param {object} info
 * @param {string} info.sql
 * @param {number} info.durationMs
 * @param {string} [info.route]
 * @param {string} [info.method]
 * @param {string} [info.requestId]
 * @param {string} [info.correlationId]
 * @param {*} [info.params]
 */
function logSlowQuery(info = {}) {
    const sanitized = sanitizeSql(info.sql);
    const durationMs = Number(info.durationMs) || 0;
    const route = info.route || "background";
    const method = info.method || "-";
    const requestId = info.requestId || info.correlationId || "-";

    const payload = {
        type: "slow_query",
        durationMs,
        route,
        method,
        requestId,
        sql: sanitized,
        paramCount: Array.isArray(info.params) ? info.params.length : 0
    };

    logger.warn(
        `Slow query (${durationMs}ms) ${method} ${route} [${requestId}]: ${sanitized}`
    );

    if (process.env.NODE_ENV === "development") {
        logger.debug(`Slow query detail: ${JSON.stringify(payload)}`);
    }

    return payload;
}

module.exports = {
    sanitizeSql,
    logSlowQuery
};
