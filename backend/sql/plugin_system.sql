-- Plugins Table
CREATE TABLE IF NOT EXISTS plugins (
    id INT PRIMARY KEY AUTO_INCREMENT,
    plugin_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    description TEXT,
    author VARCHAR(255),
    type VARCHAR(50) NOT NULL,
    dependencies JSON,
    hooks JSON,
    routes JSON,
    services JSON,
    status ENUM('active', 'inactive', 'error', 'deprecated') DEFAULT 'active',
    path VARCHAR(500),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plugin Hooks Log
CREATE TABLE IF NOT EXISTS plugin_hooks_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    plugin_id VARCHAR(100) NOT NULL,
    hook_name VARCHAR(100) NOT NULL,
    data JSON,
    result JSON,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_plugin (plugin_id),
    INDEX idx_hook (hook_name),
    INDEX idx_executed (executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;