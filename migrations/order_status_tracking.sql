-- ============================================
-- ORDER STATUS TRACKING MIGRATION
-- ============================================

-- ============================================
-- ADD NEW COLUMNS TO ORDERS TABLE
-- ============================================

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS estimated_delivery DATE,
ADD COLUMN IF NOT EXISTS tracking_url VARCHAR(500),
ADD COLUMN IF NOT EXISTS status_changed_by INT,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

ADD INDEX idx_status (status),
ADD INDEX idx_user_id_status (user_id, status),
ADD INDEX idx_created_at (created_at),
ADD INDEX idx_updated_at (updated_at),
ADD INDEX idx_status_created (status, created_at),
ADD INDEX idx_deleted_at (deleted_at);

-- ============================================
-- ORDER STATUS LOGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS order_status_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    reason TEXT,
    updated_by INT,
    updated_by_name VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    is_auto TINYINT(1) DEFAULT 0,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_order_id (order_id),
    INDEX idx_old_status (old_status),
    INDEX idx_new_status (new_status),
    INDEX idx_created_at (created_at),
    INDEX idx_order_status_created (order_id, created_at),
    INDEX idx_updated_by (updated_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- ORDER STATUS TRIGGER
-- ============================================

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
-- STORED PROCEDURE: Get Order Timeline
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE get_order_timeline(IN p_order_id INT)
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

DELIMITER ;

-- ============================================
-- STORED PROCEDURE: Get Order Status Statistics
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE get_order_status_stats(
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

DELIMITER ;

-- ============================================
-- STORED PROCEDURE: Cleanup Old Status Logs
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE cleanup_old_status_logs(IN p_retention_days INT)
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

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX idx_order_status_logs_order_id_created 
ON order_status_logs(order_id, created_at);

CREATE INDEX idx_order_status_logs_new_status_created 
ON order_status_logs(new_status, created_at);