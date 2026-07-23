-- AI Decision Logs Table
CREATE TABLE IF NOT EXISTS ai_decision_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    order_total DECIMAL(10,2) NOT NULL,
    proposed_discount DECIMAL(10,2) NOT NULL,
    applied_discount DECIMAL(10,2) NOT NULL,
    reasons JSON,
    items JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_timestamp (timestamp),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin Approval Requests Table
CREATE TABLE IF NOT EXISTS admin_approval_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    order_total DECIMAL(10,2) NOT NULL,
    discount DECIMAL(10,2) NOT NULL,
    discount_percentage DECIMAL(5,2) NOT NULL,
    promo_code VARCHAR(50),
    items JSON,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    admin_id INT NULL,
    admin_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- View for monitoring
CREATE VIEW discount_anomaly_view AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_decisions,
    SUM(CASE WHEN proposed_discount > applied_discount THEN 1 ELSE 0 END) as overridden,
    AVG(proposed_discount - applied_discount) as avg_override_amount,
    MAX(proposed_discount - applied_discount) as max_override
FROM ai_decision_logs
WHERE proposed_discount > applied_discount
GROUP BY DATE(timestamp)
ORDER BY date DESC;