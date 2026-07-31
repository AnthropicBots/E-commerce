// backend/controllers/aiFinancialController.js

const {
  approveAIDecision,
  getPendingApprovals,
  getAIAuditLogs,
  FINANCIAL_LIMITS
} = require('../middleware/aiFinancialGuard');

// ============================================
// HELPER FUNCTION (Moved from route file)
// ============================================
async function executeAIAction(action, data, userId) {
  // Placeholder - implement actual action execution
  switch (action) {
    case 'apply_discount':
      return {
        action: 'discount_applied',
        discount: data.discount,
        orderTotal: data.orderTotal,
        userId
      };
    case 'process_order':
      return {
        action: 'order_processed',
        total: data.total,
        userId
      };
    default:
      return {
        action: 'unknown_action',
        data,
        userId
      };
  }
}

// ==================== CONTROLLER METHODS ====================

/**
 * Execute AI financial action
 */
exports.executeAction = async (req, res) => {
  try {
    const { action } = req.body;
    const guardedAction = req.guardedAction;

    // Execute the guarded action
    const result = await executeAIAction(action, guardedAction, req.user.id);

    res.json({
      success: true,
      message: 'AI action executed with financial guard',
      action,
      guardApplied: guardedAction.guardApplied || false,
      result
    });
  } catch (error) {
    console.error('Action execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute AI action'
    });
  }
};

/**
 * Approve pending AI decision (admin only)
 */
exports.approveDecision = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { id } = req.params;
    const { action, notes } = req.body;

    const approvedAction = await approveAIDecision(id, req.user.id, notes);

    if (!approvedAction) {
      return res.status(404).json({
        success: false,
        error: 'Approval request not found or already processed'
      });
    }

    res.json({
      success: true,
      message: 'AI decision approved',
      action: approvedAction
    });
  } catch (error) {
    console.error('Approval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve decision'
    });
  }
};

/**
 * Get pending approvals (admin only)
 */
exports.getPending = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const pending = await getPendingApprovals();

    res.json({
      success: true,
      data: pending,
      count: pending.length
    });
  } catch (error) {
    console.error('Get pending error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get pending approvals'
    });
  }
};

/**
 * Get audit logs (admin only)
 */
exports.getAuditLogs = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { userId, status, fromDate, toDate } = req.query;
    const logs = await getAIAuditLogs({ userId, status, fromDate, toDate });

    res.json({
      success: true,
      data: logs,
      count: logs.length
    });
  } catch (error) {
    console.error('Audit error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get audit logs'
    });
  }
};

/**
 * Get financial limits configuration
 */
exports.getLimits = (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      error: "Admin access required"
    });
  }

  return res.json({
    success: true,
    limits: FINANCIAL_LIMITS
  });
};