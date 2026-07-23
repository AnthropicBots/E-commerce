// backend/middleware/discountValidator.js
const db = require('../config/db').promise;

// ============================================
// DISCOUNT RULES CONFIGURATION
// ============================================

const DISCOUNT_RULES = {
    maxPercentageOff: 70,           // Max 70% off
    maxAbsoluteDiscount: 1000,      // Max ₹1000 discount
    allowedPromoCodes: ['SUMMER25', 'WELCOME10', 'WEEKEND20', 'FLAT50'],
    minOrderForDiscount: 500,       // Minimum order ₹500
    singleUsePerCustomer: true,     // Each promo code once per customer
    adminApprovalRequired: 50,      // >50% discount needs admin approval
    maxDiscountPerOrder: 2000       // Max discount per order
};

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate AI-generated discount against business rules
 */
async function validateDiscount({ 
    requestedDiscount, 
    orderTotal, 
    userId, 
    promoCode,
    items = []
}) {
    let finalDiscount = 0;
    const reasons = [];

    // Rule 1: Max percentage discount
    const maxPercentageAmount = (orderTotal * DISCOUNT_RULES.maxPercentageOff) / 100;
    if (requestedDiscount > maxPercentageAmount) {
        finalDiscount = maxPercentageAmount;
        reasons.push(`Discount limited to ${DISCOUNT_RULES.maxPercentageOff}% (₹${maxPercentageAmount})`);
    } else {
        finalDiscount = requestedDiscount;
    }

    // Rule 2: Max absolute discount
    if (finalDiscount > DISCOUNT_RULES.maxAbsoluteDiscount) {
        finalDiscount = DISCOUNT_RULES.maxAbsoluteDiscount;
        reasons.push(`Discount limited to ₹${DISCOUNT_RULES.maxAbsoluteDiscount}`);
    }

    // Rule 3: Max discount per order
    if (finalDiscount > DISCOUNT_RULES.maxDiscountPerOrder) {
        finalDiscount = DISCOUNT_RULES.maxDiscountPerOrder;
        reasons.push(`Discount limited to ₹${DISCOUNT_RULES.maxDiscountPerOrder} per order`);
    }

    // Rule 4: Valid promo code
    if (promoCode) {
        const isValid = DISCOUNT_RULES.allowedPromoCodes.includes(promoCode.toUpperCase());
        if (!isValid) {
            finalDiscount = 0;
            reasons.push(`Invalid promo code: ${promoCode}`);
        }
    }

    // Rule 5: Minimum order requirement
    if (orderTotal < DISCOUNT_RULES.minOrderForDiscount) {
        finalDiscount = 0;
        reasons.push(`Minimum order ₹${DISCOUNT_RULES.minOrderForDiscount} required`);
    }

    // Rule 6: Single use per customer
    if (promoCode && DISCOUNT_RULES.singleUsePerCustomer) {
        const usedCount = await getDiscountUsageCount(userId, promoCode);
        if (usedCount > 0) {
            finalDiscount = 0;
            reasons.push(`Promo code ${promoCode} already used by this customer`);
        }
    }

    // Rule 7: Product restrictions (optional)
    if (items.length > 0) {
        const discountedItems = items.filter(item => item.isDiscounted);
        if (discountedItems.length > 0 && finalDiscount > 0) {
            // Additional validation for discounted items
            const maxItemDiscount = Math.min(...discountedItems.map(i => i.price * 0.7));
            if (finalDiscount > maxItemDiscount) {
                finalDiscount = maxItemDiscount;
                reasons.push(`Limited by item discount restrictions`);
            }
        }
    }

    return {
        finalDiscount,
        appliedRules: reasons,
        isModified: finalDiscount !== requestedDiscount,
        originalRequested: requestedDiscount
    };
}

/**
 * Get usage count for a promo code by customer
 */
async function getDiscountUsageCount(userId, promoCode) {
    try {
        const [rows] = await db.query(
            `SELECT COUNT(*) as count 
             FROM orders 
             WHERE user_id = ? 
             AND promo_code = ? 
             AND status != 'cancelled'`,
            [userId, promoCode.toUpperCase()]
        );
        return rows[0]?.count || 0;
    } catch (error) {
        console.error('Error checking promo usage:', error);
        return 0;
    }
}

/**
 * Check if admin approval is required
 */
function requiresAdminApproval(discountPercentage) {
    return discountPercentage > DISCOUNT_RULES.adminApprovalRequired;
}

/**
 * Log AI financial decisions for audit
 */
async function logAIDecision({ 
    userId, 
    items, 
    proposedDiscount, 
    appliedDiscount, 
    reasons,
    orderTotal 
}) {
    try {
        await db.query(
            `INSERT INTO ai_decision_logs 
             (user_id, order_total, proposed_discount, applied_discount, 
              reasons, items, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [
                userId,
                orderTotal,
                proposedDiscount,
                appliedDiscount,
                JSON.stringify(reasons),
                JSON.stringify(items)
            ]
        );
        console.log(`✅ AI Decision Logged: User ${userId}, Proposed ${proposedDiscount}, Applied ${appliedDiscount}`);
    } catch (error) {
        console.error('Error logging AI decision:', error);
    }
}

// ============================================
// EXPRESS MIDDLEWARE
// ============================================

/**
 * Middleware to validate discount in checkout
 */
async function validateDiscountMiddleware(req, res, next) {
    try {
        const { items, promoCode, discount: aiGeneratedDiscount } = req.body;
        
        if (!items || items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No items in cart'
            });
        }

        // Calculate order total
        const orderTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        // Validate discount
        const validationResult = await validateDiscount({
            requestedDiscount: aiGeneratedDiscount || 0,
            orderTotal,
            userId: req.user.id,
            promoCode,
            items
        });

        // Check if admin approval required
        const discountPercentage = (validationResult.finalDiscount / orderTotal) * 100;
        if (requiresAdminApproval(discountPercentage)) {
            // Create admin approval request
            const approvalId = await createApprovalRequest({
                userId: req.user.id,
                discount: validationResult.finalDiscount,
                discountPercentage,
                items,
                orderTotal,
                promoCode
            });

            await logAIDecision({
                userId: req.user.id,
                items,
                proposedDiscount: validationResult.originalRequested,
                appliedDiscount: validationResult.finalDiscount,
                reasons: ['Admin approval required - discount > 50%'],
                orderTotal
            });

            return res.status(202).json({
                success: true,
                message: 'Large discount requires admin approval',
                approvalId,
                discount: validationResult.finalDiscount,
                discountPercentage: discountPercentage.toFixed(2),
                status: 'pending_approval'
            });
        }

        // Log AI decision
        if (validationResult.isModified) {
            await logAIDecision({
                userId: req.user.id,
                items,
                proposedDiscount: validationResult.originalRequested,
                appliedDiscount: validationResult.finalDiscount,
                reasons: validationResult.appliedRules,
                orderTotal
            });

            console.warn(`⚠️ AI discount overridden: User ${req.user.id}, Proposed ${validationResult.originalRequested}, Applied ${validationResult.finalDiscount}`);
        }

        // Attach validated discount to request
        req.validatedDiscount = validationResult;
        req.validatedOrderTotal = orderTotal;

        next();
    } catch (error) {
        console.error('❌ Discount validation error:', error);
        return res.status(500).json({
            success: false,
            error: 'Discount validation failed'
        });
    }
}

/**
 * Create admin approval request
 */
async function createApprovalRequest({ userId, discount, discountPercentage, items, orderTotal, promoCode }) {
    try {
        const [result] = await db.query(
            `INSERT INTO admin_approval_requests 
             (user_id, order_total, discount, discount_percentage, 
              promo_code, items, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
            [userId, orderTotal, discount, discountPercentage, promoCode, JSON.stringify(items)]
        );
        return result.insertId;
    } catch (error) {
        console.error('Error creating approval request:', error);
        throw error;
    }
}

/**
 * Get discount rules (for frontend)
 */
function getDiscountRules(req, res) {
    return res.json({
        success: true,
        rules: {
            maxPercentageOff: DISCOUNT_RULES.maxPercentageOff,
            maxAbsoluteDiscount: DISCOUNT_RULES.maxAbsoluteDiscount,
            minOrderForDiscount: DISCOUNT_RULES.minOrderForDiscount,
            allowedPromoCodes: DISCOUNT_RULES.allowedPromoCodes,
            adminApprovalRequired: DISCOUNT_RULES.adminApprovalRequired
        }
    });
}

module.exports = {
    validateDiscountMiddleware,
    validateDiscount,
    getDiscountRules,
    DISCOUNT_RULES,
    logAIDecision
};