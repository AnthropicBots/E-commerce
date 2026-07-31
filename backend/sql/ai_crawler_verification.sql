-- ============================================
-- CRAWLER VERIFICATION LOGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS crawler_verification_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ip_address VARCHAR(45) NOT NULL,
    user_agent VARCHAR(255),
    crawler_type VARCHAR(50),
    is_verified BOOLEAN DEFAULT FALSE,
    confidence INT DEFAULT 0,
    flags JSON,
    details JSON,
    request_id VARCHAR(36),
    country_code VARCHAR(2),
    verification_method VARCHAR(50),
    created_by INT,
    updated_by INT,
    deleted_at DATETIME,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_ip (ip_address),
    INDEX idx_crawler (crawler_type),
    INDEX idx_verified (is_verified),
    INDEX idx_timestamp (timestamp),
    INDEX idx_ip_verified (ip_address, is_verified),
    INDEX idx_crawler_verified (crawler_type, is_verified),
    INDEX idx_confidence (confidence),
    INDEX idx_request_id (request_id),
    INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(timestamp)) (
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- ============================================
-- BLOCKED IPS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS blocked_ips (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ip_address VARCHAR(45) UNIQUE NOT NULL,
    reason TEXT,
    blocked_by INT,
    unblocked_by INT,
    blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    unblocked_at DATETIME,
    unblock_reason TEXT,
    blocked_duration_days INT,
    is_permanent BOOLEAN DEFAULT FALSE,
    created_by INT,
    updated_by INT,
    deleted_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_ip (ip_address),
    INDEX idx_blocked (blocked_at),
    INDEX idx_is_permanent (is_permanent),
    INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- CRAWLER VERIFICATION DASHBOARD VIEW
-- ============================================

CREATE OR REPLACE VIEW crawler_verification_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_requests,
    SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_requests,
    SUM(CASE WHEN is_verified = 0 THEN 1 ELSE 0 END) as suspicious_requests,
    ROUND(AVG(confidence), 2) as avg_confidence,
    COUNT(DISTINCT ip_address) as unique_ips,
    COUNT(DISTINCT crawler_type) as unique_crawlers,
    ROUND((SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) * 100, 2) as verification_rate,
    COUNT(DISTINCT country_code) as unique_countries
FROM crawler_verification_logs
WHERE deleted_at IS NULL
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- ============================================
-- IP BLOCK SUMMARY VIEW
-- ============================================

CREATE OR REPLACE VIEW ip_block_summary AS
SELECT 
    ip_address,
    COUNT(*) as block_count,
    MAX(blocked_at) as last_blocked,
    MIN(blocked_at) as first_blocked,
    TIMESTAMPDIFF(DAY, MIN(blocked_at), COALESCE(MAX(unblocked_at), NOW())) as total_blocked_days,
    SUM(CASE WHEN unblocked_at IS NULL AND is_permanent = FALSE THEN 1 ELSE 0 END) as active_blocks,
    SUM(CASE WHEN is_permanent = TRUE THEN 1 ELSE 0 END) as permanent_blocks,
    GROUP_CONCAT(DISTINCT reason) as reasons
FROM blocked_ips
WHERE deleted_at IS NULL
GROUP BY ip_address
ORDER BY active_blocks DESC, last_blocked DESC;

-- ============================================
-- CRAWLER TYPE SUMMARY VIEW
-- ============================================

CREATE OR REPLACE VIEW crawler_type_summary AS
SELECT 
    crawler_type,
    COUNT(*) as total_requests,
    SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_count,
    SUM(CASE WHEN is_verified = 0 THEN 1 ELSE 0 END) as suspicious_count,
    ROUND((SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) * 100, 2) as verification_rate,
    ROUND(AVG(confidence), 2) as avg_confidence,
    COUNT(DISTINCT ip_address) as unique_ips
FROM crawler_verification_logs
WHERE deleted_at IS NULL
GROUP BY crawler_type
ORDER BY total_requests DESC;

-- ============================================
-- STORED PROCEDURE: Block IP
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE block_ip(
    IN p_ip_address VARCHAR(45),
    IN p_reason TEXT,
    IN p_blocked_by INT,
    IN p_duration_days INT,
    IN p_is_permanent BOOLEAN
)
BEGIN
    INSERT INTO blocked_ips (
        ip_address, reason, blocked_by, 
        blocked_duration_days, is_permanent, created_at
    ) VALUES (
        p_ip_address, p_reason, p_blocked_by,
        p_duration_days, p_is_permanent, NOW()
    ) ON DUPLICATE KEY UPDATE
        reason = p_reason,
        blocked_by = p_blocked_by,
        blocked_duration_days = p_duration_days,
        is_permanent = p_is_permanent,
        unblocked_at = NULL,
        unblock_reason = NULL,
        updated_at = NOW();
    
    SELECT ROW_COUNT() as affected_rows;
END //

DELIMITER ;

-- ============================================
-- STORED PROCEDURE: Unblock IP
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE unblock_ip(
    IN p_ip_address VARCHAR(45),
    IN p_unblock_reason TEXT,
    IN p_unblocked_by INT
)
BEGIN
    UPDATE blocked_ips
    SET unblocked_at = NOW(),
        unblock_reason = p_unblock_reason,
        unblocked_by = p_unblocked_by,
        updated_at = NOW()
    WHERE ip_address = p_ip_address
      AND unblocked_at IS NULL
      AND deleted_at IS NULL;
    
    SELECT ROW_COUNT() as affected_rows;
END //

DELIMITER ;

-- ============================================
-- STORED PROCEDURE: Cleanup Old Logs
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE cleanup_crawler_logs(IN retention_days INT)
BEGIN
    DECLARE affected_rows INT;
    
    START TRANSACTION;
    
    DELETE FROM crawler_verification_logs
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL retention_days DAY)
      AND is_verified = TRUE
      AND deleted_at IS NULL;
    
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
        'CLEANUP_CRAWLER_LOGS',
        'crawler_verification_logs',
        0,
        JSON_OBJECT('deleted_rows', affected_rows),
        NOW()
    );
    
    COMMIT;
    
    SELECT affected_rows as deleted_rows;
END //

DELIMITER ;

-- ============================================
-- EVENT: Auto-Cleanup Old Logs (Keep 30 days)
-- ============================================

CREATE EVENT IF NOT EXISTS cleanup_crawler_logs_event
ON SCHEDULE EVERY 1 WEEK
STARTS CURRENT_DATE + INTERVAL 7 DAY + INTERVAL 4 HOUR
DO
    CALL cleanup_crawler_logs(30);

-- ============================================
-- TRIGGER: Auto-audit on insert
-- ============================================

DELIMITER //

CREATE TRIGGER trg_crawler_log_insert
AFTER INSERT ON crawler_verification_logs
FOR EACH ROW
BEGIN
    INSERT INTO activity_logs (
        user_id,
        action,
        resource_type,
        resource_id,
        new_values,
        created_at
    ) VALUES (
        NULL,
        'CRAWLER_LOG_INSERT',
        'crawler_verification_logs',
        NEW.id,
        JSON_OBJECT('ip', NEW.ip_address, 'crawler_type', NEW.crawler_type, 'is_verified', NEW.is_verified),
        NOW()
    );
END //

DELIMITER ;

-- ============================================
-- TRIGGER: Auto-audit on update
-- ============================================

DELIMITER //

CREATE TRIGGER trg_crawler_log_update
AFTER UPDATE ON crawler_verification_logs
FOR EACH ROW
BEGIN
    INSERT INTO activity_logs (
        user_id,
        action,
        resource_type,
        resource_id,
        old_values,
        new_values,
        created_at
    ) VALUES (
        NULL,
        'CRAWLER_LOG_UPDATE',
        'crawler_verification_logs',
        NEW.id,
        JSON_OBJECT('is_verified', OLD.is_verified, 'confidence', OLD.confidence),
        JSON_OBJECT('is_verified', NEW.is_verified, 'confidence', NEW.confidence),
        NOW()
    );
END //

DELIMITER ;