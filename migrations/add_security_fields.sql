-- =====================
-- ADD SECURITY FIELDS TO USERS TABLE
-- =====================

-- Add new columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS failed_login_attempts INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS lockout_until DATETIME NULL,
ADD COLUMN IF NOT EXISTS last_login DATETIME NULL,
ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL,
ADD COLUMN IF NOT EXISTS delete_reason VARCHAR(500) NULL;

-- =====================
-- CREATE PASSWORD HISTORY TABLE
-- =====================
CREATE TABLE IF NOT EXISTS password_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id)
);

-- =====================
-- CREATE REFRESH TOKENS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    token VARCHAR(500) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    is_revoked BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_token (token),
    INDEX idx_user_id (user_id)
);

-- =====================
-- CREATE SECURITY LOGS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS security_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NULL,
    event_type VARCHAR(50) NOT NULL,
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_event_type (event_type),
    INDEX idx_created_at (created_at)
);

-- =====================
-- UPDATE EXISTING USERS
-- =====================
UPDATE users SET failed_login_attempts = 0 WHERE failed_login_attempts IS NULL;

-- =====================
-- VERIFY CHANGES
-- =====================
SELECT 
    COLUMN_NAME, 
    DATA_TYPE, 
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'users' 
AND COLUMN_NAME IN ('failed_login_attempts', 'lockout_until', 'last_login', 'deleted_at', 'delete_reason');