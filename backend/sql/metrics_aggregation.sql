-- Aggregated Metrics Table
CREATE TABLE IF NOT EXISTS aggregated_metrics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    period VARCHAR(20) NOT NULL,
    metrics JSON NOT NULL,
    summary JSON NOT NULL,
    aggregated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_period (period),
    INDEX idx_aggregated (aggregated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Metrics Dashboard View
CREATE VIEW metrics_dashboard AS
SELECT 
    DATE(aggregated_at) as date,
    period,
    JSON_EXTRACT(metrics, '$.summary.totalRevenue') as total_revenue,
    JSON_EXTRACT(metrics, '$.summary.averageOrderValue') as avg_order_value,
    JSON_EXTRACT(metrics, '$.summary.conversionRate') as conversion_rate
FROM aggregated_metrics
WHERE aggregated_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
ORDER BY aggregated_at DESC;