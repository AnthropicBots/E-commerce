-- ADR Records Table
CREATE TABLE IF NOT EXISTS adr_records (
    id INT PRIMARY KEY AUTO_INCREMENT,
    adr_id VARCHAR(50) UNIQUE NOT NULL,
    number INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    status ENUM('proposed', 'accepted', 'superseded', 'deprecated', 'rejected') DEFAULT 'proposed',
    context TEXT NOT NULL,
    decision TEXT NOT NULL,
    alternatives TEXT,
    consequences TEXT,
    related TEXT,
    adr_date DATE NOT NULL,
    category VARCHAR(50) NOT NULL,
    tags JSON,
    author VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_number (number),
    INDEX idx_status (status),
    INDEX idx_category (category),
    INDEX idx_date (adr_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ADR Comments Table
CREATE TABLE IF NOT EXISTS adr_comments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    adr_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    comment TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_adr (adr_id),
    INDEX idx_user (user_id),
    FOREIGN KEY (adr_id) REFERENCES adr_records(adr_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ADR Dashboard View
CREATE VIEW adr_dashboard AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_adrs,
    SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
    SUM(CASE WHEN status = 'proposed' THEN 1 ELSE 0 END) as proposed,
    COUNT(DISTINCT category) as categories,
    COUNT(DISTINCT author) as authors
FROM adr_records
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY date DESC;