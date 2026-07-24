-- Cache Configurations Table
CREATE TABLE IF NOT EXISTS cache_configurations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    cache_name VARCHAR(100) UNIQUE NOT NULL,
    strategy VARCHAR(50) DEFAULT 'adaptive',
    max_size INT DEFAULT 104857600,
    min_size INT DEFAULT 10485760,
    hit_rate DECIMAL(5,2) DEFAULT 0,
    eviction_count INT DEFAULT 0,
    enabled BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (cache_name),
    INDEX idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Memory Metrics History
CREATE TABLE IF NOT EXISTS memory_metrics_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    heap_used BIGINT,
    heap_total BIGINT,
    heap_max BIGINT,
    external BIGINT,
    array_buffers BIGINT,
    memory_pressure DECIMAL(5,2),
    pressure_level VARCHAR(20),
    cache_size BIGINT,
    cache_items INT,
    gc_count INT,
    gc_time INT,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pressure (memory_pressure),
    INDEX idx_recorded (recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;