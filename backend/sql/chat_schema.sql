CREATE TABLE IF NOT EXISTS chat_conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    assigned_admin_id INT NULL,
    status ENUM('open', 'pending', 'closed') DEFAULT 'open',
    priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    closed_at TIMESTAMP NULL,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_admin_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT NOT NULL,
    sender_id INT NOT NULL,
    sender_type ENUM('customer', 'admin', 'system') NOT NULL,
    message TEXT NOT NULL,
    delivered BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_customer ON chat_conversations(customer_id);
CREATE INDEX idx_chat_admin ON chat_conversations(assigned_admin_id);
CREATE INDEX idx_chat_status ON chat_conversations(status);
CREATE INDEX idx_chat_msg_conv ON chat_messages(conversation_id);
