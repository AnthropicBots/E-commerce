// backend/controllers/adminApprovalController.js
const db = require('../config/db').promise;

/**
 * Get pending approval requests (Admin only)
 */
exports.getPendingApprovals = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const [requests] = await db.query(`
            SELECT a.*, u.name as user_name, u.email as user_email
            FROM admin_approval_requests a
            JOIN users u ON a.user_id = u.id
            WHERE a.status = 'pending'
            ORDER BY a.created_at DESC
        `);

    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    console.error('Error fetching approvals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch approvals'
    });
  }
};

exports.decideApproval = async (req, res) => {
  let connection;
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const { id } = req.params;
    const { action, notes } = req.body;


    if (!id || !/^[1-9]\d*$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid approval request identifier. It must be a positive integer.'
      });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action'
      });
    }


    const MAX_NOTE_LENGTH = 500;
    let sanitizedNotes = null;
    if (notes !== undefined && notes !== null) {
      if (typeof notes !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Admin notes must be a string if provided.'
        });
      }
      const trimmedNotes = notes.trim();
      if (trimmedNotes.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Admin notes cannot be empty or contain only whitespace.'
        });
      }
      if (trimmedNotes.length > MAX_NOTE_LENGTH) {
        return res.status(400).json({
          success: false,
          error: `Admin notes cannot exceed ${MAX_NOTE_LENGTH} characters.`
        });
      }
      sanitizedNotes = trimmedNotes;
    }

    const [existingRequest] = await db.query(
      `SELECT status FROM admin_approval_requests WHERE id = ?`,
      [id]
    );

    if (existingRequest.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Approval request not found.'
      });
    }

    if (existingRequest[0].status !== 'pending') {
      return res.status(409).json({
        success: false,
        error: `Request is already ${existingRequest[0].status}. Cannot re-process an already decided request.`
      });
    }


    connection = await db.getConnection(); // 1. Acquire connection from pool
    await connection.beginTransaction();   // 2. Start the transaction

    try {
      // Step 1: Update the approval request status
      const [updateResult] = await connection.query(
        `UPDATE admin_approval_requests
     SET status = ?, admin_id = ?, admin_notes = ?
     WHERE id = ? AND status = 'pending'`,
        [
          status,
          req.user.id,
          adminNotes,
          id
        ]
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "This approval request has already been processed by another administrator."
        });
      }

      // Step 2: If approved, proceed with associated business logic within the SAME transaction
      if (action === 'approve') {
        // ... (Your actual order processing query goes here. Always use `connection.query`)
        // Example: await connection.query(`UPDATE orders SET status = 'approved' WHERE request_id = ?`, [id]);
      }

      // Step 3: Commit the transaction if all steps succeed
      await connection.commit();

      return res.json({
        success: true,
        message: `Request ${action}d successfully`
      });

    } catch (error) {
      // Step 4: Rollback if any step in the try block fails
      await connection.rollback();
      throw error;
    }

  } catch (error) {
    console.error('Error updating approval:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update approval'
    });
  } finally {
    // Step 5: Always release the connection back to the pool
    if (connection) connection.release();
  }
};