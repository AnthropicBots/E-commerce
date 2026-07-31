-- Admin dashboard audit trail.
--
-- The user references are CHAR(36): `users.id` is a UUID, and the INT columns
-- this file previously declared made the foreign keys unbuildable, so the whole
-- definition failed on any database whose users table came from the baseline.

CREATE TABLE IF NOT EXISTS user_audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id CHAR(36) NOT NULL,
    target_user_id CHAR(36),
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
