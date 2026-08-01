-- Knowledge Graph Versions
CREATE TABLE IF NOT EXISTS knowledge_graph_versions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    version_number INT NOT NULL,
    node_count INT DEFAULT 0,
    edge_count INT DEFAULT 0,
    graph_data JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_version (version_number),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Graph Dashboard View
CREATE VIEW graph_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_versions,
    AVG(node_count) as avg_nodes,
    AVG(edge_count) as avg_edges,
    MIN(node_count) as min_nodes,
    MAX(node_count) as max_nodes
FROM knowledge_graph_versions
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;