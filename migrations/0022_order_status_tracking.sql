-- ============================================
-- ORDER STATUS TRACKING
-- ============================================
--
-- Folded in from the hand-written change file `order_status_tracking.sql`, which
-- could not be applied as written:
--
--   * it used `ADD COLUMN IF NOT EXISTS` and `ADD INDEX` for columns and
--     indexes the baseline already declares, and `ADD COLUMN IF NOT EXISTS` is
--     MariaDB syntax that MySQL rejects outright;
--   * it re-added `idx_status_created`, which the baseline already defines on
--     orders, and added second copies of indexes the baseline covers under
--     other names;
--   * `order_status_logs.order_id` and `updated_by` were INT against CHAR(36)
--     parents, so its foreign keys could not be built;
--   * it used `CREATE OR REPLACE PROCEDURE`, which MySQL does not support.
--
-- What is left is the columns and objects the baseline genuinely lacks.

ALTER TABLE orders
    ADD COLUMN cancellation_reason TEXT NULL,
    ADD COLUMN shipped_at TIMESTAMP NULL,
    ADD COLUMN estimated_delivery DATE NULL,
    ADD COLUMN tracking_url VARCHAR(500) NULL,
    ADD COLUMN status_changed_by CHAR(36) NULL,
    ADD INDEX idx_orders_status_changed_by (status_changed_by);

-- ============================================
-- ORDER STATUS LOGS
-- ============================================

CREATE TABLE IF NOT EXISTS order_status_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id CHAR(36) NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    reason TEXT,
    updated_by CHAR(36),
    updated_by_name VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    is_auto TINYINT(1) DEFAULT 0,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_order_status_logs_order (order_id),
    INDEX idx_order_status_logs_new_status (new_status),
    INDEX idx_order_status_logs_order_created (order_id, created_at),
    INDEX idx_order_status_logs_status_created (new_status, created_at),
    INDEX idx_order_status_logs_updated_by (updated_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- ORDER STATUS TRIGGER
-- ============================================
-- A status change writes its own log row, so a change made by any path -- admin
-- action, cron job or direct SQL -- is recorded. `status_changed_by` being NULL
-- is what marks a change as automatic.

DROP TRIGGER IF EXISTS trg_order_status_change;

DELIMITER //

CREATE TRIGGER trg_order_status_change
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    IF OLD.status != NEW.status THEN
        INSERT INTO order_status_logs (
            order_id,
            old_status,
            new_status,
            reason,
            updated_by,
            updated_by_name,
            is_auto,
            metadata,
            created_at
        ) VALUES (
            NEW.id,
            OLD.status,
            NEW.status,
            CASE 
                WHEN NEW.status = 'cancelled' THEN NEW.cancellation_reason
                ELSE NULL
            END,
            NEW.status_changed_by,
            (SELECT name FROM users WHERE id = NEW.status_changed_by),
            CASE WHEN NEW.status_changed_by IS NULL THEN 1 ELSE 0 END,
            JSON_OBJECT(
                'old_total', OLD.total,
                'new_total', NEW.total,
                'old_payment_status', OLD.payment_status,
                'new_payment_status', NEW.payment_status
            ),
            NOW()
        );
    END IF;
END //

DELIMITER ;

-- ============================================
-- ORDER SUMMARY VIEW
-- ============================================

CREATE OR REPLACE VIEW order_summary_view AS
SELECT 
    o.id,
    o.user_id,
    o.customer_name,
    o.customer_email,
    o.status,
    o.total,
    o.subtotal,
    o.discount,
    o.shipping_cost,
    o.tax,
    o.payment_status,
    o.payment_method,
    o.created_at,
    o.updated_at,
    o.shipped_at,
    o.delivered_at,
    o.cancelled_at,
    o.refunded_at,
    o.estimated_delivery,
    o.tracking_number,
    o.tracking_url,
    COUNT(oi.id) as item_count,
    SUM(oi.qty) as total_items,
    SUM(oi.total) as items_total,
    (SELECT COUNT(*) FROM order_status_logs WHERE order_id = o.id) as status_change_count,
    (SELECT new_status FROM order_status_logs WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) as last_status,
    (SELECT created_at FROM order_status_logs WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) as last_status_change
FROM orders o
LEFT JOIN order_items oi ON o.id = oi.order_id
WHERE o.deleted_at IS NULL
GROUP BY o.id;

-- ============================================
-- ORDER STATUS DURATION VIEW
-- ============================================

CREATE OR REPLACE VIEW order_status_duration AS
SELECT 
    order_id,
    TIMESTAMPDIFF(HOUR, MIN(created_at), MAX(created_at)) as total_hours,
    TIMESTAMPDIFF(DAY, MIN(created_at), MAX(created_at)) as total_days,
    COUNT(*) as status_changes,
    JSON_ARRAYAGG(
        JSON_OBJECT(
            'status', new_status,
            'changed_at', created_at,
            'old_status', old_status,
            'reason', reason
        )
    ) as status_history
FROM order_status_logs
GROUP BY order_id;

-- ============================================
-- STORED PROCEDURES
-- ============================================

DROP PROCEDURE IF EXISTS get_order_timeline;
DROP PROCEDURE IF EXISTS get_order_status_stats;
DROP PROCEDURE IF EXISTS cleanup_old_status_logs;

DELIMITER //

CREATE PROCEDURE get_order_timeline(IN p_order_id CHAR(36))
BEGIN
    SELECT 
        id,
        old_status,
        new_status,
        reason,
        updated_by_name,
        is_auto,
        created_at,
        TIMESTAMPDIFF(MINUTE, 
            LAG(created_at) OVER (ORDER BY created_at), 
            created_at
        ) as minutes_since_previous
    FROM order_status_logs
    WHERE order_id = p_order_id
    ORDER BY created_at DESC;
END //

CREATE PROCEDURE get_order_status_stats(
    IN p_start_date DATE,
    IN p_end_date DATE
)
BEGIN
    SELECT 
        status,
        COUNT(*) as count,
        SUM(total) as total_value,
        AVG(total) as avg_value,
        MIN(created_at) as first_order,
        MAX(created_at) as last_order,
        AVG(TIMESTAMPDIFF(HOUR, created_at, 
            CASE 
                WHEN status = 'delivered' THEN delivered_at
                WHEN status = 'cancelled' THEN cancelled_at
                ELSE NOW()
            END
        )) as avg_completion_hours
    FROM orders
    WHERE DATE(created_at) BETWEEN p_start_date AND p_end_date
      AND deleted_at IS NULL
    GROUP BY status
    ORDER BY count DESC;
END //

CREATE PROCEDURE cleanup_old_status_logs(IN p_retention_days INT)
BEGIN
    DECLARE affected_rows INT;

    DELETE FROM order_status_logs
    WHERE created_at < DATE_SUB(NOW(), INTERVAL p_retention_days DAY);

    SET affected_rows = ROW_COUNT();

    INSERT INTO activity_logs (
        user_id,
        action,
        resource_type,
        resource_id,
        new_values,
        created_at
    ) VALUES (
        NULL,
        'CLEANUP_ORDER_STATUS_LOGS',
        'order_status_logs',
        0,
        JSON_OBJECT('deleted_rows', affected_rows),
        NOW()
    );

    SELECT affected_rows as deleted_rows;
END //

DELIMITER ;

-- ============================================
-- EVENT: Auto-Cleanup Old Status Logs (Keep 180 days)
-- ============================================

CREATE EVENT IF NOT EXISTS cleanup_old_status_logs_event
ON SCHEDULE EVERY 1 MONTH
STARTS CURRENT_DATE + INTERVAL 1 MONTH + INTERVAL 1 HOUR
DO
    CALL cleanup_old_status_logs(180);
