-- backend/scripts/admin_dashboard_schema.sql

CREATE TABLE IF NOT EXISTS user_audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NOT NULL,
    target_user_id INT,
    action VARCHAR(100) NOT NULL,
    metadata JSON,
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Index for fast queries
CREATE INDEX idx_audit_admin ON user_audit_logs(admin_id);
CREATE INDEX idx_audit_action ON user_audit_logs(action);
CREATE INDEX idx_audit_created ON user_audit_logs(created_at);
