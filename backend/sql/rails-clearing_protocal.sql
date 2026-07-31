-- RAILS Obligations
CREATE TABLE IF NOT EXISTS rails_obligations (
    id VARCHAR(100) PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    amount DECIMAL(10,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'INR',
    description TEXT,
    terms JSON,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    status ENUM('active', 'cleared', 'expired', 'disputed') DEFAULT 'active',
    admissibility_grade INT DEFAULT 0,
    evidence_hash VARCHAR(255),
    verification_mesh VARCHAR(100),
    clearing_decision VARCHAR(100),
    settlement_instruction VARCHAR(100),
    clearing_passport VARCHAR(100),
    finality_rule VARCHAR(100),
    cleared_at DATETIME,
    INDEX idx_agent (agent_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- RAILS Evidence
CREATE TABLE IF NOT EXISTS rails_evidence (
    id VARCHAR(100) PRIMARY KEY,
    obligation_id VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    data JSON,
    timestamp DATETIME NOT NULL,
    hash VARCHAR(255) NOT NULL,
    signature VARCHAR(255) NOT NULL,
    status ENUM('submitted', 'verified', 'rejected') DEFAULT 'submitted',
    admissibility_grade INT DEFAULT 0,
    FOREIGN KEY (obligation_id) REFERENCES rails_obligations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- RAILS Verification Mesh
CREATE TABLE IF NOT EXISTS rails_verification_mesh (
    id VARCHAR(100) PRIMARY KEY,
    obligation_id VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    verification JSON,
    witnesses JSON,
    attestations JSON,
    consensus DECIMAL(3,2) DEFAULT 0,
    timestamp DATETIME NOT NULL,
    admissibility_grade INT DEFAULT 0,
    status ENUM('active', 'expired') DEFAULT 'active',
    FOREIGN KEY (obligation_id) REFERENCES rails_obligations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- RAILS Clearing Decisions
CREATE TABLE IF NOT EXISTS rails_clearing_decisions (
    id VARCHAR(100) PRIMARY KEY,
    obligation_id VARCHAR(100) NOT NULL,
    action ENUM('settle', 'reject', 'defer', 'escalate') NOT NULL,
    reason TEXT,
    timestamp DATETIME NOT NULL,
    admissibility_grade INT DEFAULT 0,
    evidence_hash VARCHAR(255),
    verification_mesh VARCHAR(100),
    FOREIGN KEY (obligation_id) REFERENCES rails_obligations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- RAILS Settlement Instructions
CREATE TABLE IF NOT EXISTS rails_settlement_instructions (
    id VARCHAR(100) PRIMARY KEY,
    obligation_id VARCHAR(100) NOT NULL,
    decision_id VARCHAR(100) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR',
    from_account VARCHAR(255),
    to_account VARCHAR(255),
    method VARCHAR(50),
    timestamp DATETIME NOT NULL,
    status ENUM('pending', 'executed', 'failed') DEFAULT 'pending',
    FOREIGN KEY (obligation_id) REFERENCES rails_obligations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- RAILS Clearing Passports
CREATE TABLE IF NOT EXISTS rails_clearing_passports (
    id VARCHAR(100) PRIMARY KEY,
    obligation_id VARCHAR(100) NOT NULL,
    evidence_hash VARCHAR(255),
    verification_mesh VARCHAR(100),
    clearing_decision VARCHAR(100),
    settlement_instruction VARCHAR(100),
    admissibility_grade INT DEFAULT 0,
    finality_rule VARCHAR(100),
    timestamp DATETIME NOT NULL,
    hash VARCHAR(255) NOT NULL,
    signature VARCHAR(255) NOT NULL,
    FOREIGN KEY (obligation_id) REFERENCES rails_obligations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- RAILS Finality Records
CREATE TABLE IF NOT EXISTS rails_finality_records (
    id VARCHAR(100) PRIMARY KEY,
    obligation_id VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    conditions JSON,
    timestamp DATETIME NOT NULL,
    status ENUM('active', 'finalized') DEFAULT 'active',
    FOREIGN KEY (obligation_id) REFERENCES rails_obligations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;