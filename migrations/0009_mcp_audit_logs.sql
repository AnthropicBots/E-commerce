-- MCP Audit Logs Table
--
-- user_id is CHAR(36) to match `users.id`; declared as INT, the foreign key
-- below could not be built and the whole file failed to apply.
CREATE TABLE IF NOT EXISTS mcp_audit_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id CHAR(36) NULL,
    ip_address VARCHAR(45) NOT NULL,
    module VARCHAR(100) NOT NULL,
    function VARCHAR(100) NOT NULL,
    args JSON,
    status ENUM('success', 'error', 'blocked') NOT NULL,
    error_message TEXT NULL,
    response_time INT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_module (module),
    INDEX idx_timestamp (timestamp),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;