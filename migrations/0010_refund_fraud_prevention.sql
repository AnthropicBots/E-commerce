-- Refund fraud alerts and tamper-evidence logs.
--
-- User references are CHAR(36) to match `users.id`; declared as INT, the
-- foreign keys below could not be built and the whole file failed to apply.

-- Refund Fraud Alerts Table
CREATE TABLE IF NOT EXISTS refund_fraud_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id CHAR(36) NOT NULL,
    order_id VARCHAR(100) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    confidence INT DEFAULT 0,
    flags JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_by CHAR(36),
    resolution_notes TEXT,
    INDEX idx_user (user_id),
    INDEX idx_order (order_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_resolved (resolved),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tamper Evidence Logs Table
CREATE TABLE IF NOT EXISTS tamper_evidence_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id VARCHAR(100) NOT NULL,
    product_id VARCHAR(100) NOT NULL,
    user_id CHAR(36) NOT NULL,
    qr_data JSON NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order (order_id),
    INDEX idx_product (product_id),
    INDEX idx_user (user_id),
    INDEX idx_timestamp (timestamp),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Refund Fraud Dashboard View
--
-- Named for the feature it reports on. It and the synthetic-identity dashboard
-- were both called `fraud_detection_dashboard` over unrelated tables, so
-- whichever was created second either failed or replaced the other.
CREATE VIEW refund_fraud_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_alerts,
    SUM(CASE WHEN confidence > 85 THEN 1 ELSE 0 END) as critical_alerts,
    SUM(CASE WHEN confidence > 70 AND confidence <= 85 THEN 1 ELSE 0 END) as high_alerts,
    SUM(CASE WHEN resolved = TRUE THEN 1 ELSE 0 END) as resolved_alerts,
    AVG(confidence) as avg_confidence
FROM refund_fraud_alerts
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;