-- AI Prompt Analytics Table
CREATE TABLE IF NOT EXISTS ai_prompt_analytics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) NOT NULL,
    risk_score INT DEFAULT 0,
    risk_level ENUM('low', 'medium', 'high', 'critical') DEFAULT 'low',
    detected_patterns JSON,
    suspicious_entities JSON,
    sanitized_prompt TEXT,
    context JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_risk (risk_level),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI Authorization Requests
CREATE TABLE IF NOT EXISTS ai_authorization_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    data JSON,
    status ENUM('pending', 'confirmed', 'rejected') DEFAULT 'pending',
    admin_id VARCHAR(100),
    admin_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    confirmed_at DATETIME,
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Monitoring View
CREATE VIEW prompt_security_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_analyses,
    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_count,
    SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_count,
    SUM(CASE WHEN risk_level = 'medium' THEN 1 ELSE 0 END) as medium_count,
    SUM(CASE WHEN risk_level = 'low' THEN 1 ELSE 0 END) as low_count,
    AVG(risk_score) as avg_risk_score
FROM ai_prompt_analytics
GROUP BY DATE(timestamp)
ORDER BY date DESC;