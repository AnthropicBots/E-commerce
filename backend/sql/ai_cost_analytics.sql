-- ============================================
-- AI COST ANALYTICS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS ai_cost_analytics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    original_cost DECIMAL(10,6) NOT NULL,
    actual_cost DECIMAL(10,6) NOT NULL,
    savings_percentage DECIMAL(5,2) NOT NULL,
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,
    cached_tokens INT DEFAULT 0,
    request_id VARCHAR(36) DEFAULT NULL,
    user_agent VARCHAR(255) DEFAULT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    response_time_ms INT DEFAULT NULL,
    status VARCHAR(20) DEFAULT 'success',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user (user_id),
    INDEX idx_endpoint (endpoint),
    INDEX idx_timestamp (timestamp),
    INDEX idx_user_timestamp (user_id, timestamp),
    INDEX idx_endpoint_timestamp (endpoint, timestamp),
    INDEX idx_status (status),
    INDEX idx_savings (savings_percentage),
    INDEX idx_request_id (request_id),
    INDEX idx_user_endpoint (user_id, endpoint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(timestamp)) (
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- ============================================
-- MONTHLY SAVINGS VIEW
-- ============================================

CREATE OR REPLACE VIEW monthly_cost_savings AS
SELECT 
    DATE_FORMAT(timestamp, '%Y-%m') as month,
    COUNT(*) as total_requests,
    SUM(original_cost) as total_original_cost,
    SUM(actual_cost) as total_actual_cost,
    SUM(original_cost - actual_cost) as total_savings,
    ROUND(((SUM(original_cost) - SUM(actual_cost)) / NULLIF(SUM(original_cost), 0)) * 100, 2) as savings_percentage,
    SUM(input_tokens) as total_input_tokens,
    SUM(cached_tokens) as total_cached_tokens,
    SUM(output_tokens) as total_output_tokens,
    ROUND((SUM(cached_tokens) / NULLIF(SUM(input_tokens), 0)) * 100, 2) as cache_hit_rate
FROM ai_cost_analytics
WHERE status = 'success'
GROUP BY month
ORDER BY month DESC;

-- ============================================
-- DAILY SAVINGS VIEW
-- ============================================

CREATE OR REPLACE VIEW daily_cost_savings AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_requests,
    SUM(original_cost) as total_original_cost,
    SUM(actual_cost) as total_actual_cost,
    SUM(original_cost - actual_cost) as total_savings,
    ROUND(((SUM(original_cost) - SUM(actual_cost)) / NULLIF(SUM(original_cost), 0)) * 100, 2) as savings_percentage,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT endpoint) as unique_endpoints
FROM ai_cost_analytics
WHERE status = 'success'
GROUP BY date
ORDER BY date DESC
LIMIT 30;

-- ============================================
-- USER AGGREGATION VIEW
-- ============================================

CREATE OR REPLACE VIEW user_cost_savings AS
SELECT 
    user_id,
    COUNT(*) as total_requests,
    SUM(original_cost) as total_original_cost,
    SUM(actual_cost) as total_actual_cost,
    SUM(original_cost - actual_cost) as total_savings,
    ROUND(((SUM(original_cost) - SUM(actual_cost)) / NULLIF(SUM(original_cost), 0)) * 100, 2) as savings_percentage,
    SUM(input_tokens) as total_input_tokens,
    SUM(cached_tokens) as total_cached_tokens,
    ROUND((SUM(cached_tokens) / NULLIF(SUM(input_tokens), 0)) * 100, 2) as cache_hit_rate,
    MAX(timestamp) as last_activity,
    MIN(timestamp) as first_activity
FROM ai_cost_analytics
WHERE status = 'success'
GROUP BY user_id
ORDER BY total_savings DESC;

-- ============================================
-- ENDPOINT PERFORMANCE VIEW
-- ============================================

CREATE OR REPLACE VIEW endpoint_cost_savings AS
SELECT 
    endpoint,
    COUNT(*) as total_requests,
    SUM(original_cost) as total_original_cost,
    SUM(actual_cost) as total_actual_cost,
    SUM(original_cost - actual_cost) as total_savings,
    ROUND(((SUM(original_cost) - SUM(actual_cost)) / NULLIF(SUM(original_cost), 0)) * 100, 2) as savings_percentage,
    SUM(input_tokens) as total_input_tokens,
    SUM(cached_tokens) as total_cached_tokens,
    ROUND((SUM(cached_tokens) / NULLIF(SUM(input_tokens), 0)) * 100, 2) as cache_hit_rate,
    AVG(response_time_ms) as avg_response_time,
    MAX(response_time_ms) as max_response_time
FROM ai_cost_analytics
WHERE status = 'success'
GROUP BY endpoint
ORDER BY total_savings DESC;

-- ============================================
-- HOURLY TRENDING VIEW
-- ============================================

CREATE OR REPLACE VIEW hourly_cost_trend AS
SELECT 
    DATE_FORMAT(timestamp, '%Y-%m-%d %H:00:00') as hour,
    COUNT(*) as total_requests,
    SUM(original_cost) as total_original_cost,
    SUM(actual_cost) as total_actual_cost,
    SUM(original_cost - actual_cost) as total_savings,
    ROUND(((SUM(original_cost) - SUM(actual_cost)) / NULLIF(SUM(original_cost), 0)) * 100, 2) as savings_percentage
FROM ai_cost_analytics
WHERE status = 'success'
  AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY hour
ORDER BY hour DESC;

-- ============================================
-- SUMMARY TABLE (for faster queries)
-- ============================================

CREATE TABLE IF NOT EXISTS ai_cost_summary (
    id INT PRIMARY KEY AUTO_INCREMENT,
    summary_date DATE NOT NULL,
    total_requests INT DEFAULT 0,
    total_original_cost DECIMAL(10,6) DEFAULT 0,
    total_actual_cost DECIMAL(10,6) DEFAULT 0,
    total_savings DECIMAL(10,6) DEFAULT 0,
    savings_percentage DECIMAL(5,2) DEFAULT 0,
    unique_users INT DEFAULT 0,
    unique_endpoints INT DEFAULT 0,
    total_input_tokens BIGINT DEFAULT 0,
    total_cached_tokens BIGINT DEFAULT 0,
    cache_hit_rate DECIMAL(5,2) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_summary_date (summary_date),
    INDEX idx_date (summary_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STORED PROCEDURE: Generate Daily Summary
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE generate_daily_summary(IN target_date DATE)
BEGIN
    INSERT INTO ai_cost_summary (
        summary_date,
        total_requests,
        total_original_cost,
        total_actual_cost,
        total_savings,
        savings_percentage,
        unique_users,
        unique_endpoints,
        total_input_tokens,
        total_cached_tokens,
        cache_hit_rate
    )
    SELECT 
        target_date,
        COUNT(*) as total_requests,
        SUM(original_cost) as total_original_cost,
        SUM(actual_cost) as total_actual_cost,
        SUM(original_cost - actual_cost) as total_savings,
        ROUND(((SUM(original_cost) - SUM(actual_cost)) / NULLIF(SUM(original_cost), 0)) * 100, 2) as savings_percentage,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT endpoint) as unique_endpoints,
        SUM(input_tokens) as total_input_tokens,
        SUM(cached_tokens) as total_cached_tokens,
        ROUND((SUM(cached_tokens) / NULLIF(SUM(input_tokens), 0)) * 100, 2) as cache_hit_rate
    FROM ai_cost_analytics
    WHERE DATE(timestamp) = target_date
      AND status = 'success'
    ON DUPLICATE KEY UPDATE
        total_requests = VALUES(total_requests),
        total_original_cost = VALUES(total_original_cost),
        total_actual_cost = VALUES(total_actual_cost),
        total_savings = VALUES(total_savings),
        savings_percentage = VALUES(savings_percentage),
        unique_users = VALUES(unique_users),
        unique_endpoints = VALUES(unique_endpoints),
        total_input_tokens = VALUES(total_input_tokens),
        total_cached_tokens = VALUES(total_cached_tokens),
        cache_hit_rate = VALUES(cache_hit_rate),
        updated_at = CURRENT_TIMESTAMP;
END //

DELIMITER ;

-- ============================================
-- STORED PROCEDURE: Cleanup Old Data
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE cleanup_old_analytics(IN retention_days INT)
BEGIN
    DECLARE affected_rows INT;
    
    DELETE FROM ai_cost_analytics
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL retention_days DAY);
    
    SET affected_rows = ROW_COUNT();
    
    INSERT INTO audit_log (table_name, action, affected_rows, timestamp)
    VALUES ('ai_cost_analytics', 'CLEANUP', affected_rows, NOW());
    
    SELECT affected_rows as deleted_rows;
END //

DELIMITER ;

-- ============================================
-- STORED PROCEDURE: Get Cost Analytics Dashboard
-- ============================================

DELIMITER //

CREATE OR REPLACE PROCEDURE get_cost_dashboard()
BEGIN
    -- Total savings
    SELECT 
        SUM(original_cost) as total_original_cost,
        SUM(actual_cost) as total_actual_cost,
        SUM(original_cost - actual_cost) as total_savings,
        ROUND(((SUM(original_cost) - SUM(actual_cost)) / NULLIF(SUM(original_cost), 0)) * 100, 2) as savings_percentage,
        COUNT(*) as total_requests,
        COUNT(DISTINCT user_id) as unique_users,
        COUNT(DISTINCT endpoint) as unique_endpoints
    FROM ai_cost_analytics
    WHERE status = 'success'
      AND timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY);
    
    -- Top 10 users by savings
    SELECT 
        user_id,
        COUNT(*) as requests,
        SUM(original_cost - actual_cost) as savings,
        ROUND(((SUM(original_cost) - SUM(actual_cost)) / NULLIF(SUM(original_cost), 0)) * 100, 2) as savings_percentage
    FROM ai_cost_analytics
    WHERE status = 'success'
    GROUP BY user_id
    ORDER BY savings DESC
    LIMIT 10;
    
    -- Top 10 endpoints by savings
    SELECT 
        endpoint,
        COUNT(*) as requests,
        SUM(original_cost - actual_cost) as savings,
        ROUND(((SUM(original_cost) - SUM(actual_cost)) / NULLIF(SUM(original_cost), 0)) * 100, 2) as savings_percentage
    FROM ai_cost_analytics
    WHERE status = 'success'
    GROUP BY endpoint
    ORDER BY savings DESC
    LIMIT 10;
    
    -- Daily trend (last 30 days)
    SELECT 
        DATE(timestamp) as date,
        COUNT(*) as requests,
        SUM(original_cost - actual_cost) as savings
    FROM ai_cost_analytics
    WHERE status = 'success'
      AND timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY date
    ORDER BY date DESC;
END //

DELIMITER ;

-- ============================================
-- EVENT: Auto-generate daily summary
-- ============================================

CREATE EVENT IF NOT EXISTS generate_daily_summary_event
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 1 HOUR
DO
    CALL generate_daily_summary(CURDATE() - INTERVAL 1 DAY);

-- ============================================
-- EVENT: Auto-cleanup old data (keep 90 days)
-- ============================================

CREATE EVENT IF NOT EXISTS cleanup_old_data_event
ON SCHEDULE EVERY 1 WEEK
STARTS CURRENT_DATE + INTERVAL 7 DAY + INTERVAL 2 HOUR
DO
    CALL cleanup_old_analytics(90);