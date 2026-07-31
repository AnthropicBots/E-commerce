-- Dependency Analysis Table
CREATE TABLE IF NOT EXISTS dependency_analysis (
    id INT PRIMARY KEY AUTO_INCREMENT,
    node_count INT DEFAULT 0,
    edge_count INT DEFAULT 0,
    cycles JSON,
    metrics JSON,
    report JSON,
    analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_analyzed (analyzed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dependency Graph (for persistence)
CREATE TABLE IF NOT EXISTS dependency_graph_nodes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    node_id VARCHAR(255) UNIQUE NOT NULL,
    node_data JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_node (node_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dependency Graph Edges
CREATE TABLE IF NOT EXISTS dependency_graph_edges (
    id INT PRIMARY KEY AUTO_INCREMENT,
    edge_id VARCHAR(255) UNIQUE NOT NULL,
    from_node VARCHAR(255) NOT NULL,
    to_node VARCHAR(255) NOT NULL,
    edge_data JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_from (from_node),
    INDEX idx_to (to_node),
    FOREIGN KEY (from_node) REFERENCES dependency_graph_nodes(node_id),
    FOREIGN KEY (to_node) REFERENCES dependency_graph_nodes(node_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;