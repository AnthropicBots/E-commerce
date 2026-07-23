-- AI Copy Generations Table
CREATE TABLE IF NOT EXISTS ai_copy_generations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    keywords JSON NOT NULL,
    category VARCHAR(100),
    target_audience VARCHAR(100),
    tone VARCHAR(50),
    generated_name VARCHAR(255) NOT NULL,
    generated_description TEXT NOT NULL,
    generated_short VARCHAR(255),
    bullet_points JSON,
    seo_keywords JSON,
    was_used BOOLEAN DEFAULT FALSE,
    product_id INT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_timestamp (timestamp),
    INDEX idx_was_used (was_used),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Copywriter Analytics View
CREATE VIEW copywriter_analytics AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_generations,
    SUM(CASE WHEN was_used = TRUE THEN 1 ELSE 0 END) as used_count,
    (SUM(CASE WHEN was_used = TRUE THEN 1 ELSE 0 END) / COUNT(*)) * 100 as adoption_rate,
    GROUP_CONCAT(DISTINCT category) as categories,
    AVG(CHAR_LENGTH(generated_description)) as avg_description_length
FROM ai_copy_generations
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- Monthly Statistics View
CREATE VIEW copywriter_monthly_stats AS
SELECT 
    DATE_FORMAT(timestamp, '%Y-%m') as month,
    COUNT(*) as total_generations,
    SUM(CASE WHEN was_used = TRUE THEN 1 ELSE 0 END) as used_count,
    (SUM(CASE WHEN was_used = TRUE THEN 1 ELSE 0 END) / COUNT(*)) * 100 as adoption_rate,
    COUNT(DISTINCT category) as categories_used
FROM ai_copy_generations
GROUP BY month
ORDER BY month DESC;