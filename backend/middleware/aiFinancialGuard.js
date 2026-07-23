const db = require("../config/db").promise;
const { v4: uuidv4 } = require("uuid"); // Install: npm install uuid

// ============================================
// CONFIGURABLE LIMITS FROM ENV
// ============================================

const FINANCIAL_LIMITS = {
  maxDiscountPercentage: parseInt(process.env.AI_MAX_DISCOUNT_PERCENTAGE) || 50,
  maxAbsoluteDiscount: parseInt(process.env.AI_MAX_ABSOLUTE_DISCOUNT) || 1000,
  maxOrderValue: parseInt(process.env.AI_MAX_ORDER_VALUE) || 50000,
  maxQuantityPerItem: parseInt(process.env.AI_MAX_QUANTITY_PER_ITEM) || 10,
  requireHumanApproval: process.env.AI_REQUIRE_HUMAN_APPROVAL !== "false",
  autoRollbackMinutes: parseInt(process.env.AI_AUTO_ROLLBACK_MINUTES) || 15,
  maxAIRequestsPerMinute: parseInt(process.env.AI_MAX_REQUESTS_PER_MINUTE) || 5,
  rateLimitCleanupInterval:
    parseInt(process.env.AI_RATE_LIMIT_CLEANUP_INTERVAL) || 60000, // 1 min
  maxRetryAttempts: parseInt(process.env.AI_MAX_RETRY_ATTEMPTS) || 3,
  retryDelayMs: parseInt(process.env.AI_RETRY_DELAY_MS) || 1000,
  enableTransactions: process.env.AI_ENABLE_TRANSACTIONS !== "false",
};

// ============================================
// RATE LIMITER WITH CLEANUP
// ============================================

class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.cleanupInterval = FINANCIAL_LIMITS.rateLimitCleanupInterval;
    this.startCleanup();
  }

  startCleanup() {
    setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window
    let cleanedCount = 0;

    for (const [key, timestamps] of this.requests.entries()) {
      const filtered = timestamps.filter((time) => time > windowStart);
      if (filtered.length === 0) {
        this.requests.delete(key);
        cleanedCount++;
      } else if (filtered.length !== timestamps.length) {
        this.requests.set(key, filtered);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Rate limiter cleanup: ${cleanedCount} entries cleaned`);
    }
  }

  isRateLimited(key) {
    const now = Date.now();
    const windowStart = now - 60000;

    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }

    const timestamps = this.requests.get(key);
    const recentRequests = timestamps.filter((time) => time > windowStart);

    if (recentRequests.length >= FINANCIAL_LIMITS.maxAIRequestsPerMinute) {
      return true;
    }

    recentRequests.push(now);
    this.requests.set(key, recentRequests);
    return false;
  }

  // Manual cleanup for testing
  forceCleanup() {
    this.cleanup();
  }
}

const aiDecisionRateLimiter = new RateLimiter();

// ============================================
// RETRY LOGIC FOR DB OPERATIONS
// ============================================

async function withRetry(operation, context = "DB operation", attempt = 1) {
  try {
    return await operation();
  } catch (error) {
    if (attempt >= FINANCIAL_LIMITS.maxRetryAttempts) {
      console.error(` ${context} failed after ${attempt} attempts:`, error);
      throw error;
    }

    console.warn(
      ` ${context} failed (attempt ${attempt}/${FINANCIAL_LIMITS.maxRetryAttempts}), retrying...`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, FINANCIAL_LIMITS.retryDelayMs * attempt),
    );
    return withRetry(operation, context, attempt + 1);
  }
}

// ============================================
// TRANSACTION SUPPORT
// ============================================

async function withTransaction(operations) {
  if (!FINANCIAL_LIMITS.enableTransactions) {
    return await operations();
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operations(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    console.error("Transaction failed, rolled back:", error);
    throw error;
  } finally {
    connection.release();
  }
}

// ============================================
// INPUT VALIDATION
// ============================================

function validateActionInput(action, data) {
  const errors = [];

  // Validate action
  if (!action) {
    errors.push("action is required");
  } else if (typeof action !== "string") {
    errors.push("action must be a string");
  } else if (
    !["apply_discount", "process_order", "update_inventory"].includes(action)
  ) {
    errors.push(
      `Invalid action: ${action}. Allowed: apply_discount, process_order, update_inventory`,
    );
  }

  // Validate data
  if (!data) {
    errors.push("data is required");
  } else if (typeof data !== "object" || Array.isArray(data)) {
    errors.push("data must be an object");
  }

  // Validate data fields based on action
  if (data && typeof data === "object") {
    switch (action) {
      case "apply_discount":
        if (data.discount === undefined) errors.push("discount is required");
        else if (isNaN(parseFloat(data.discount)))
          errors.push("discount must be a number");
        else if (parseFloat(data.discount) < 0)
          errors.push("discount cannot be negative");

        if (data.orderTotal === undefined)
          errors.push("orderTotal is required");
        else if (isNaN(parseFloat(data.orderTotal)))
          errors.push("orderTotal must be a number");
        else if (parseFloat(data.orderTotal) < 0)
          errors.push("orderTotal cannot be negative");
        break;

      case "process_order":
        if (data.total === undefined) errors.push("total is required");
        else if (isNaN(parseFloat(data.total)))
          errors.push("total must be a number");
        else if (parseFloat(data.total) < 0)
          errors.push("total cannot be negative");

        if (data.items && !Array.isArray(data.items)) {
          errors.push("items must be an array if provided");
        }
        break;

      case "update_inventory":
        if (data.quantity === undefined) errors.push("quantity is required");
        else if (isNaN(parseInt(data.quantity)))
          errors.push("quantity must be a number");
        else if (parseInt(data.quantity) < 0)
          errors.push("quantity cannot be negative");

        if (data.productId && typeof data.productId !== "string") {
          errors.push("productId must be a string if provided");
        }
        break;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// ============================================
// AI DECISION AUDIT LOG (WITH RETRY)
// ============================================

async function logAIDecision({
  userId,
  actionType,
  proposedAction,
  approvedAction,
  reason,
  status,
  ipAddress,
  correlationId = uuidv4(),
}) {
  return withRetry(async () => {
    await db.query(
      `INSERT INTO ai_financial_audit_logs 
             (user_id, action_type, proposed_action, approved_action, 
              reason, status, ip_address, correlation_id, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        userId || "anonymous",
        actionType,
        JSON.stringify(proposedAction),
        approvedAction ? JSON.stringify(approvedAction) : null,
        reason,
        status,
        ipAddress || "unknown",
        correlationId,
      ],
    );
    console.log(
      `AI Decision Logged: ${actionType} for user ${userId} (${correlationId})`,
    );
  }, "Log AI Decision");
}

// ============================================
// HUMAN-IN-THE-LOOP APPROVAL (WITH TRANSACTIONS)
// ============================================

async function createApprovalRequest({
  userId,
  actionType,
  proposedAction,
  requiresApproval = true,
  autoRollbackMinutes = FINANCIAL_LIMITS.autoRollbackMinutes,
  correlationId = uuidv4(),
}) {
  return withRetry(async () => {
    const result = await withTransaction(async (connection) => {
      const [insertResult] = await connection.query(
        `INSERT INTO ai_approval_requests 
                 (user_id, action_type, proposed_action, status, 
                  auto_rollback_at, correlation_id, created_at)
                 VALUES (?, ?, ?, 'pending', DATE_ADD(NOW(), INTERVAL ? MINUTE), ?, NOW())`,
        [
          userId,
          actionType,
          JSON.stringify(proposedAction),
          autoRollbackMinutes,
          correlationId,
        ],
      );
      return insertResult;
    });
    return result.insertId;
  }, "Create Approval Request");
}

async function autoRollbackIfPending(approvalId) {
  return withRetry(async () => {
    const [requests] = await db.query(
      `SELECT * FROM ai_approval_requests 
             WHERE id = ? AND status = 'pending'`,
      [approvalId],
    );

    if (requests.length > 0) {
      await db.query(
        `UPDATE ai_approval_requests 
                 SET status = 'auto_rolled_back', 
                     auto_rollback_reason = 'Approval timeout - automatically rolled back'
                 WHERE id = ?`,
        [approvalId],
      );
      console.log(` Auto-rolled back AI decision ${approvalId}`);
      return true;
    }
    return false;
  }, "Auto Rollback");
}

async function approveAIDecision(approvalId, adminId, notes) {
  return withRetry(async () => {
    const result = await withTransaction(async (connection) => {
      await connection.query(
        `UPDATE ai_approval_requests 
                 SET status = 'approved', 
                     approved_by = ?, 
                     approved_notes = ?,
                     approved_at = NOW()
                 WHERE id = ? AND status = 'pending'`,
        [adminId, notes, approvalId],
      );

      const [requests] = await connection.query(
        `SELECT * FROM ai_approval_requests WHERE id = ?`,
        [approvalId],
      );

      if (requests.length > 0) {
        console.log(
          `AI Decision ${approvalId} approved by admin ${adminId}`,
        );
        return JSON.parse(requests[0].proposed_action);
      }
      return null;
    });
    return result;
  }, "Approve AI Decision");
}

// ============================================
// ERROR RECOVERY WITH FALLBACK
// ============================================

async function executeWithFallback(
  action,
  data,
  userId,
  ipAddress,
  correlationId,
) {
  let fallbackExecuted = false;

  try {
    // Try normal execution
    const validationResult = await validateAIAction(action, data, userId);
    if (!validationResult.valid) {
      await logAIDecision({
        userId,
        actionType: action,
        proposedAction: data,
        approvedAction: null,
        reason: validationResult.reason,
        status: "rejected",
        ipAddress,
        correlationId,
      });
      return {
        success: false,
        error: validationResult.reason,
        fallbackUsed: false,
      };
    }

    const guardedAction = applyFinancialGuards(action, data);
    return {
      success: true,
      data: guardedAction,
      fallbackUsed: false,
    };
  } catch (error) {
    console.error("Error in AI financial guard, using fallback:", error);

    // FALLBACK: Apply safe defaults
    fallbackExecuted = true;
    const fallbackData = getFallbackData(action, data);

    await logAIDecision({
      userId,
      actionType: action,
      proposedAction: data,
      approvedAction: fallbackData,
      reason: `Fallback used due to error: ${error.message}`,
      status: "fallback",
      ipAddress,
      correlationId,
    });

    return {
      success: true,
      data: fallbackData,
      fallbackUsed: true,
      fallbackReason: error.message,
    };
  }
}

function getFallbackData(action, data) {
  const fallback = { ...data, _fallbackApplied: true };

  switch (action) {
    case "apply_discount":
      fallback.discount = 0; // No discount in fallback
      fallback._fallbackReason = "Discount disabled in fallback mode";
      break;

    case "process_order":
      fallback.total = Math.min(
        data.total || 0,
        FINANCIAL_LIMITS.maxOrderValue,
      );
      fallback._fallbackReason = "Order total capped to max limit";
      break;

    case "update_inventory":
      fallback.quantity = Math.min(data.quantity || 0, 1); // Max 1 in fallback
      fallback._fallbackReason = "Quantity limited to 1 in fallback mode";
      break;

    default:
      fallback._fallbackReason = "Unknown action, safe defaults applied";
  }

  return fallback;
}

// ============================================
// MAIN MIDDLEWARE (UPDATED)
// ============================================

async function aiFinancialGuard(req, res, next) {
  const correlationId = uuidv4();
  const startTime = Date.now();

  try {
    const { action, data } = req.body;
    const userId = req.user?.id || "anonymous";
    const ipAddress = req.ip || req.connection.remoteAddress;

    // 1. INPUT VALIDATION
    const validationResult = validateActionInput(action, data);
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        error: "Invalid input",
        details: validationResult.errors,
        correlationId,
      });
    }

    // 2. RATE LIMITING (with cleanup)
    const rateKey = `${userId}:${ipAddress}`;
    if (aiDecisionRateLimiter.isRateLimited(rateKey)) {
      await logAIDecision({
        userId,
        actionType: action,
        proposedAction: data,
        approvedAction: null,
        reason: "Rate limit exceeded",
        status: "rate_limited",
        ipAddress,
        correlationId,
      });

      return res.status(429).json({
        success: false,
        error: "Too many AI financial decisions. Please slow down.",
        retryAfter: 60,
        correlationId,
      });
    }

    // 3. EXECUTE WITH FALLBACK
    const result = await executeWithFallback(
      action,
      data,
      userId,
      ipAddress,
      correlationId,
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        correlationId,
      });
    }

    // 4. Check if human approval is required
    if (FINANCIAL_LIMITS.requireHumanApproval && !result.fallbackUsed) {
      const approvalId = await createApprovalRequest({
        userId,
        actionType: action,
        proposedAction: result.data,
        autoRollbackMinutes: FINANCIAL_LIMITS.autoRollbackMinutes,
        correlationId,
      });

      await logAIDecision({
        userId,
        actionType: action,
        proposedAction: data,
        approvedAction: result.data,
        reason: "Pending human approval",
        status: "pending_approval",
        ipAddress,
        correlationId,
      });

      const responseTime = Date.now() - startTime;
      return res.status(202).json({
        success: true,
        message: "AI action requires human approval",
        approvalId,
        autoRollbackMinutes: FINANCIAL_LIMITS.autoRollbackMinutes,
        status: "pending_approval",
        correlationId,
        responseTime: `${responseTime}ms`,
        fallbackUsed: result.fallbackUsed,
      });
    }

    // 5. If no approval needed or fallback used, execute
    req.guardedAction = result.data;
    req.correlationId = correlationId;

    await logAIDecision({
      userId,
      actionType: action,
      proposedAction: data,
      approvedAction: result.data,
      reason: result.fallbackUsed
        ? `Fallback used: ${result.fallbackReason}`
        : "Approved by AI financial guard",
      status: result.fallbackUsed ? "fallback_approved" : "approved",
      ipAddress,
      correlationId,
    });

    const responseTime = Date.now() - startTime;
    res.setHeader("X-Correlation-Id", correlationId);
    res.setHeader("X-Response-Time", `${responseTime}ms`);

    next();
  } catch (error) {
    console.error(" AI Financial Guard Error:", error);
    return res.status(500).json({
      success: false,
      error: "AI financial guard validation failed",
      correlationId,
      fallbackUsed: true,
      errorDetails:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

// ============================================
// VALIDATION FUNCTIONS (KEEP EXISTING)
// ============================================

async function validateAIAction(action, data, userId) {
  const validation = { valid: true, reason: "" };

  switch (action) {
    case "apply_discount":
      const discount = parseFloat(data.discount || 0);
      const orderTotal = parseFloat(data.orderTotal || 0);

      const maxDiscountAmount =
        (orderTotal * FINANCIAL_LIMITS.maxDiscountPercentage) / 100;
      if (discount > maxDiscountAmount) {
        validation.valid = false;
        validation.reason = `Discount exceeds max ${FINANCIAL_LIMITS.maxDiscountPercentage}% limit`;
        return validation;
      }

      if (discount > FINANCIAL_LIMITS.maxAbsoluteDiscount) {
        validation.valid = false;
        validation.reason = `Discount exceeds max ₹${FINANCIAL_LIMITS.maxAbsoluteDiscount}`;
        return validation;
      }

      const recentDiscounts = await getUserRecentDiscounts(userId);
      if (recentDiscounts > 3) {
        validation.valid = false;
        validation.reason = "User has used too many discounts recently";
        return validation;
      }
      break;

    case "process_order":
      const total = parseFloat(data.total || 0);
      if (total > FINANCIAL_LIMITS.maxOrderValue) {
        validation.valid = false;
        validation.reason = `Order total exceeds max ${FINANCIAL_LIMITS.maxOrderValue}`;
        return validation;
      }
      break;

    case "update_inventory":
      const quantity = parseInt(data.quantity || 0);
      if (quantity > FINANCIAL_LIMITS.maxQuantityPerItem) {
        validation.valid = false;
        validation.reason = `Quantity exceeds max ${FINANCIAL_LIMITS.maxQuantityPerItem} per item`;
        return validation;
      }
      break;

    default:
      validation.valid = false;
      validation.reason = `Unknown action: ${action}`;
      return validation;
  }

  return validation;
}

async function getUserRecentDiscounts(userId) {
  return withRetry(async () => {
    const [rows] = await db.query(
      `SELECT COUNT(*) as count 
             FROM ai_financial_audit_logs 
             WHERE user_id = ? 
             AND action_type = 'apply_discount'
             AND timestamp > DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      [userId],
    );
    return rows[0]?.count || 0;
  }, "Get User Recent Discounts");
}

function applyFinancialGuards(action, data) {
  const guarded = { ...data };

  switch (action) {
    case "apply_discount":
      const orderTotal = parseFloat(data.orderTotal || 0);
      const requestedDiscount = parseFloat(data.discount || 0);
      const maxDiscount =
        (orderTotal * FINANCIAL_LIMITS.maxDiscountPercentage) / 100;
      guarded.discount = Math.min(
        requestedDiscount,
        maxDiscount,
        FINANCIAL_LIMITS.maxAbsoluteDiscount,
      );
      guarded.guardApplied = guarded.discount !== requestedDiscount;
      break;

    case "process_order":
      guarded.total = Math.min(data.total, FINANCIAL_LIMITS.maxOrderValue);
      guarded.guardApplied = guarded.total !== data.total;
      break;

    case "update_inventory":
      guarded.quantity = Math.min(
        data.quantity,
        FINANCIAL_LIMITS.maxQuantityPerItem,
      );
      guarded.guardApplied = guarded.quantity !== data.quantity;
      break;
  }

  return guarded;
}

// ============================================
// ADMIN FUNCTIONS (WITH RETRY)
// ============================================

async function getPendingApprovals() {
  return withRetry(async () => {
    const [rows] = await db.query(
      `SELECT a.*, u.name as user_name, u.email as user_email
             FROM ai_approval_requests a
             JOIN users u ON a.user_id = u.id
             WHERE a.status = 'pending'
             ORDER BY a.created_at ASC`,
    );
    return rows;
  }, "Get Pending Approvals");
}

async function getAIAuditLogs(filters = {}) {
  return withRetry(async () => {
    let query = `
            SELECT a.*, u.name as user_name
            FROM ai_financial_audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            WHERE 1=1
        `;
    const params = [];

    if (filters.userId) {
      query += " AND a.user_id = ?";
      params.push(filters.userId);
    }

    if (filters.status) {
      query += " AND a.status = ?";
      params.push(filters.status);
    }

    if (filters.fromDate) {
      query += " AND a.timestamp >= ?";
      params.push(filters.fromDate);
    }

    if (filters.toDate) {
      query += " AND a.timestamp <= ?";
      params.push(filters.toDate);
    }

    if (filters.correlationId) {
      query += " AND a.correlation_id = ?";
      params.push(filters.correlationId);
    }

    query += " ORDER BY a.timestamp DESC LIMIT 100";

    const [rows] = await db.query(query, params);
    return rows;
  }, "Get AI Audit Logs");
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  aiFinancialGuard,
  approveAIDecision,
  getPendingApprovals,
  getAIAuditLogs,
  FINANCIAL_LIMITS,
  logAIDecision,
  RateLimiter,
  withRetry,
  withTransaction,
  validateActionInput,
  executeWithFallback,
};

// ============================================
// DURABLE BACKGROUND WORKER (IMPROVED)
// ============================================

const rollbackWorker = setInterval(
  async () => {
    try {
      await withRetry(async () => {
        const [expiredRequests] = await db.query(
          `SELECT id, correlation_id FROM ai_approval_requests 
                 WHERE status = 'pending' AND auto_rollback_at <= NOW()`,
        );

        if (expiredRequests.length > 0) {
          console.log(
            ` Found ${expiredRequests.length} expired approvals to rollback`,
          );

          for (const req of expiredRequests) {
            await db.query(
              `UPDATE ai_approval_requests 
                         SET status = 'auto_rolled_back', 
                             auto_rollback_reason = 'Approval timeout - automatically rolled back by worker'
                         WHERE id = ?`,
              [req.id],
            );
            console.log(
              `Auto-rolled back AI decision ${req.id} (${req.correlation_id})`,
            );
          }
        }
      }, "Rollback Worker");
    } catch (error) {
      console.error(" Error in rollback worker:", error);
    }
  },
  FINANCIAL_LIMITS.autoRollbackMinutes * 60 * 1000,
); // Run at interval of autoRollbackMinutes

// Cleanup on process exit
process.on("SIGINT", () => {
  clearInterval(rollbackWorker);
});
