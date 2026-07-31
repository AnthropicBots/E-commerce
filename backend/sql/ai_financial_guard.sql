-- ============================================
-- AI FINANCIAL AUDIT LOGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS ai_financial_audit_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    proposed_action JSON NOT NULL,
    approved_action JSON,
    reason TEXT,
    status ENUM('pending_approval', 'approved', 'rejected', 'auto_rolled_back') NOT NULL,
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    request_id VARCHAR(36),
    risk_score INT DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user (user_id),
    INDEX idx_action (action_type),
    INDEX idx_status (status),
    INDEX idx_timestamp (timestamp),
    INDEX idx_user_status (user_id, status),
    INDEX idx_action_status (action_type, status),
    INDEX idx_request_id (request_id),
    INDEX idx_risk_score (risk_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(timestamp)) (
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- ============================================
-- AI APPROVAL REQUESTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS ai_approval_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    proposed_action JSON NOT NULL,
    status ENUM('pending', 'approved', 'rejected', 'auto_rolled_back', 'expired') DEFAULT 'pending',
    approved_by VARCHAR(100),
    approved_notes TEXT,
    auto_rollback_at DATETIME,
    auto_rollback_reason TEXT,
    risk_score INT DEFAULT 0,
    priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    expired_at DATETIME,
    
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at),
    INDEX idx_auto_rollback (auto_rollback_at),
    INDEX idx_user_status (user_id, status),
    INDEX idx_priority (priority),
    INDEX idx_expired (expired_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- AUDIT TRAIL TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS ai_audit_trail (
    id INT PRIMARY KEY AUTO_INCREMENT,
    audit_id VARCHAR(36) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id INT NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_value JSON,
    new_value JSON,
    changed_by VARCHAR(100),
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    
    INDEX idx_audit_id (audit_id),
    INDEX idx_table_record (table_name, record_id),
    INDEX idx_action (action),
    INDEX idx_changed_by (changed_by),
    INDEX idx_changed_at (changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- AI DECISION MONITORING VIEW
-- ============================================

CREATE OR REPLACE VIEW ai_decision_monitoring AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_decisions,
    SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
    SUM(CASE WHEN status = 'auto_rolled_back' THEN 1 ELSE 0 END) as auto_rolled_back_count,
    SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) as pending_count,
    GROUP_CONCAT(DISTINCT action_type) as action_types,
    ROUND(AVG(risk_score), 2) as avg_risk_score,
    COUNT(DISTINCT user_id) as unique_users
FROM ai_financial_audit_logs
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- ============================================
-- USER ACTION SUMMARY VIEW
-- ============================================

CREATE OR REPLACE VIEW ai_user_action_summary AS
SELECT 
    user_id,
    COUNT(*) as total_actions,
    SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
    SUM(CASE WHEN status = 'auto_rolled_back' THEN 1 ELSE 0 END) as auto_rolled_back_count,
    SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) as pending_count,
    ROUND(AVG(risk_score), 2) as avg_risk_score,
    MAX(timestamp) as last_activity,
    MIN(timestamp) as first_activity
FROM ai_financial_audit_logs
GROUP BY user_id
ORDER BY total_actions DESC;

-- ============================================
-- ACTION TYPE SUMMARY VIEW
-- ============================================

CREATE OR REPLACE VIEW ai_action_type_summary AS
SELECT 
    action_type,
    COUNT(*) as total_actions,
    SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
    ROUND((SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) * 100, 2) as approval_rate,
    ROUND(AVG(risk_score), 2) as avg_risk_score
FROM ai_financial_audit_logs
GROUP BY action_type
ORDER BY total_actions DESC;

-- ============================================
-- STORED PROCEDURE: Get Decision Dashboard
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE get_decision_dashboard()
BEGIN
    -- Today's summary
    SELECT 
        COUNT(*) as total_decisions,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) as pending,
        ROUND(AVG(risk_score), 2) as avg_risk
    FROM ai_financial_audit_logs
    WHERE DATE(timestamp) = CURDATE();
    
    -- Pending approvals
    SELECT 
        id, user_id, action_type, proposed_action, risk_score, priority, created_at
    FROM ai_approval_requests
    WHERE status = 'pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT 20;
    
    -- Last 7 days trend
    SELECT 
        DATE(timestamp) as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved
    FROM ai_financial_audit_logs
    WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY DATE(timestamp)
    ORDER BY date DESC;
END //

DELIMITER ;

-- ============================================
-- STORED PROCEDURE: Log Audit Trail
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE log_audit_trail(
    IN p_table_name VARCHAR(100),
    IN p_record_id INT,
    IN p_action VARCHAR(20),
    IN p_old_value JSON,
    IN p_new_value JSON,
    IN p_changed_by VARCHAR(100),
    IN p_ip_address VARCHAR(45)
)
BEGIN
    INSERT INTO ai_audit_trail (
        audit_id, table_name, record_id, action, 
        old_value, new_value, changed_by, ip_address
    ) VALUES (
        UUID(), p_table_name, p_record_id, p_action,
        p_old_value, p_new_value, p_changed_by, p_ip_address
    );
END //

DELIMITER ;

-- ============================================
-- STORED PROCEDURE: Auto-Rollback Check
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE check_auto_rollback()
BEGIN
    UPDATE ai_approval_requests
    SET status = 'auto_rolled_back',
        auto_rollback_reason = 'Auto-rollback triggered due to timeout'
    WHERE status = 'pending'
      AND auto_rollback_at IS NOT NULL
      AND auto_rollback_at <= NOW();
    
    SELECT ROW_COUNT() as rolled_back_count;
END //

DELIMITER ;

-- ============================================
-- STORED PROCEDURE: Cleanup Old Data
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE cleanup_financial_logs(IN retention_days INT)
BEGIN
    DECLARE affected_rows INT;
    
    START TRANSACTION;
    
    DELETE FROM ai_financial_audit_logs
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL retention_days DAY)
      AND status IN ('approved', 'rejected');
    
    SET affected_rows = ROW_COUNT();
    
    INSERT INTO ai_audit_trail (
        audit_id, table_name, record_id, action, 
        old_value, new_value, changed_by
    ) VALUES (
        UUID(), 'ai_financial_audit_logs', 0, 'CLEANUP',
        JSON_OBJECT('deleted_count', affected_rows),
        NULL, 'SYSTEM'
    );
    
    COMMIT;
    
    SELECT affected_rows as deleted_rows;
END //

DELIMITER ;

-- ============================================
-- EVENT: Auto-Rollback Check (Every 5 minutes)
-- ============================================

CREATE EVENT IF NOT EXISTS auto_rollback_check_event
ON SCHEDULE EVERY 5 MINUTE
STARTS CURRENT_TIMESTAMP
DO
    CALL check_auto_rollback();

-- ============================================
-- EVENT: Cleanup Old Logs (Keep 90 days)
-- ============================================

CREATE EVENT IF NOT EXISTS cleanup_financial_logs_event
ON SCHEDULE EVERY 1 WEEK
STARTS CURRENT_DATE + INTERVAL 7 DAY + INTERVAL 3 HOUR
DO
    CALL cleanup_financial_logs(90);

-- ============================================
-- TRIGGER: Auto-audit on insert
-- ============================================

DELIMITER //

CREATE TRIGGER trg_ai_financial_audit_insert
AFTER INSERT ON ai_financial_audit_logs
FOR EACH ROW
BEGIN
    INSERT INTO ai_audit_trail (
        audit_id, table_name, record_id, action, 
        new_value, changed_at
    ) VALUES (
        UUID(), 'ai_financial_audit_logs', NEW.id, 'INSERT',
        JSON_OBJECT('action_type', NEW.action_type, 'status', NEW.status),
        NOW()
    );
END //

DELIMITER ;

-- ============================================
-- TRIGGER: Auto-audit on update
-- ============================================

DELIMITER //

CREATE TRIGGER trg_ai_financial_audit_update
AFTER UPDATE ON ai_financial_audit_logs
FOR EACH ROW
BEGIN
    INSERT INTO ai_audit_trail (
        audit_id, table_name, record_id, action, 
        old_value, new_value, changed_at
    ) VALUES (
        UUID(), 'ai_financial_audit_logs', NEW.id, 'UPDATE',
        JSON_OBJECT('status', OLD.status),
        JSON_OBJECT('status', NEW.status),
        NOW()
    );
END //

DELIMITER ;