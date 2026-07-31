-- SAGE Detection Results
CREATE TABLE IF NOT EXISTS sage_detection_results (
    id INT PRIMARY KEY AUTO_INCREMENT,
    transaction_id VARCHAR(100) NOT NULL,
    data_analysis JSON,
    decision_making JSON,
    verification JSON,
    final_action ENUM('block', 'review', 'approve') DEFAULT 'pending',
    confidence DECIMAL(5,2) DEFAULT 0,
    verified BOOLEAN DEFAULT FALSE,
    reflection JSON,
    context JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_transaction (transaction_id),
    INDEX idx_action (final_action),
    INDEX idx_verified (verified),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SAGE Fraud Patterns
CREATE TABLE IF NOT EXISTS sage_fraud_patterns (
    id INT PRIMARY KEY AUTO_INCREMENT,
    type VARCHAR(50) NOT NULL,
    category VARCHAR(50),
    recommended_action ENUM('block', 'review', 'approve') DEFAULT 'review',
    active BOOLEAN DEFAULT TRUE,
    confidence DECIMAL(5,2) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SAGE Business Rules
CREATE TABLE IF NOT EXISTS sage_business_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    action ENUM('block', 'review', 'approve') DEFAULT 'review',
    category VARCHAR(50),
    valid BOOLEAN DEFAULT TRUE,
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SAGE Dashboard View
CREATE VIEW sage_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_detections,
    SUM(CASE WHEN final_action = 'block' THEN 1 ELSE 0 END) as blocked,
    SUM(CASE WHEN final_action = 'review' THEN 1 ELSE 0 END) as reviewed,
    SUM(CASE WHEN final_action = 'approve' THEN 1 ELSE 0 END) as approved,
    AVG(confidence) as avg_confidence,
    SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified_count,
    (SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) / COUNT(*)) * 100 as verification_rate
FROM sage_detection_results
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;