-- Hallucination Detection Logs
CREATE TABLE IF NOT EXISTS hallucination_detection_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id VARCHAR(100) NOT NULL,
    confidence DECIMAL(5,2) DEFAULT 0,
    flags JSON,
    warnings JSON,
    suggestions JSON,
    source VARCHAR(50) DEFAULT 'ai_generated',
    validation_result VARCHAR(20) DEFAULT 'pass',
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at DATETIME,
    resolution TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_product (product_id),
    INDEX idx_confidence (confidence),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Hallucination Dashboard View
CREATE VIEW hallucination_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_validations,
    AVG(confidence) as avg_confidence,
    SUM(CASE WHEN validation_result = 'fail' THEN 1 ELSE 0 END) as failures,
    SUM(CASE WHEN resolved = 1 THEN 1 ELSE 0 END) as resolved,
    COUNT(DISTINCT product_id) as unique_products
FROM hallucination_detection_logs
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;