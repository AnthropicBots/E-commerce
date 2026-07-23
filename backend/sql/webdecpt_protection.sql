-- backend/sql/webdecpt_protection.sql

-- ============================================
-- WEBDECEPT PROTECTION SCHEMA
-- ============================================
-- Comprehensive protection against web deception attacks
-- Includes phishing detection, URL validation, and threat intelligence

-- ============================================
-- WEBDECEPT VALIDATION LOGS
-- ============================================

CREATE TABLE IF NOT EXISTS webdecept_validation_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    -- URL Information
    url VARCHAR(2000) NOT NULL,
    url_hash CHAR(64) GENERATED ALWAYS AS (SHA2(url, 256)) STORED,
    domain VARCHAR(255) GENERATED ALWAYS AS (REGEXP_SUBSTR(url, '^(?:https?:\/\/)?([^\/]+)')) STORED,
    
    -- IP Address Tracking (NEW)
    ip_address VARCHAR(45),
    user_agent TEXT,
    request_id VARCHAR(64),
    session_id VARCHAR(64),
    
    -- Validation Results
    trust_score INT DEFAULT 0 CHECK (trust_score BETWEEN 0 AND 100),
    validation_status ENUM('pending', 'valid', 'suspicious', 'malicious', 'error') DEFAULT 'pending',
    validation_method VARCHAR(50), -- NEW: Track which method was used
    
    -- Detailed Analysis
    flags JSON, -- Security flags detected
    warnings JSON, -- Warning messages
    context JSON, -- Contextual information
    features JSON, -- Extracted features
    
    -- Threat Intelligence
    threat_level ENUM('none', 'low', 'medium', 'high', 'critical') DEFAULT 'none',
    threat_categories JSON, -- Categories of threats detected
    matched_patterns JSON, -- Patterns that matched
    
    -- URL Validation Details
    is_phishing BOOLEAN DEFAULT FALSE,
    is_malware BOOLEAN DEFAULT FALSE,
    is_scam BOOLEAN DEFAULT FALSE,
    is_deceptive BOOLEAN DEFAULT FALSE,
    is_malicious BOOLEAN DEFAULT FALSE, -- NEW: Combined flag
    redirect_chain JSON, -- Track redirects
    
    -- Performance Metrics
    validation_time_ms INT DEFAULT 0,
    cache_hit BOOLEAN DEFAULT FALSE,
    
    -- Audit Columns
    created_by INT DEFAULT NULL,
    updated_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP DEFAULT NULL,
    is_deleted TINYINT(1) DEFAULT 0,
    
    -- Indexes for Performance
    INDEX idx_url (url(255)),
    INDEX idx_url_hash (url_hash),
    INDEX idx_domain (domain),
    INDEX idx_ip_address (ip_address),
    INDEX idx_request_id (request_id),
    INDEX idx_session_id (session_id),
    INDEX idx_trust_score (trust_score),
    INDEX idx_validation_status (validation_status),
    INDEX idx_threat_level (threat_level),
    INDEX idx_created_at (created_at),
    INDEX idx_deleted (is_deleted),
    INDEX idx_is_malicious (is_malicious), -- NEW
    
    -- Composite Indexes for Common Queries
    INDEX idx_status_trust (validation_status, trust_score),
    INDEX idx_threat_created (threat_level, created_at),
    INDEX idx_phishing_status (is_phishing, validation_status),
    INDEX idx_domain_status (domain, validation_status),
    INDEX idx_ip_threat (ip_address, threat_level), -- NEW
    INDEX idx_malicious_created (is_malicious, created_at), -- NEW
    
    -- Index for deactivation checks
    INDEX idx_deleted_created (is_deleted, created_at)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (YEAR(created_at)) (
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);

-- ============================================
-- DOMAIN REPUTATION
-- ============================================

CREATE TABLE IF NOT EXISTS domain_reputation (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    -- Domain Information
    domain VARCHAR(255) UNIQUE NOT NULL,
    domain_hash CHAR(64) GENERATED ALWAYS AS (SHA2(domain, 256)) STORED,
    
    -- Reputation Scores
    trust_score INT DEFAULT 100 CHECK (trust_score BETWEEN 0 AND 100),
    security_score INT DEFAULT 100 CHECK (security_score BETWEEN 0 AND 100),
    phishing_score INT DEFAULT 0 CHECK (phishing_score BETWEEN 0 AND 100),
    malware_score INT DEFAULT 0 CHECK (malware_score BETWEEN 0 AND 100),
    scam_score INT DEFAULT 0 CHECK (scam_score BETWEEN 0 AND 100),
    
    -- Metrics
    violation_count INT DEFAULT 0,
    penalty INT DEFAULT 0,
    total_checks INT DEFAULT 0,
    suspicious_count INT DEFAULT 0,
    malicious_count INT DEFAULT 0,
    
    -- Domain Details
    registrar VARCHAR(255),
    creation_date DATETIME,
    expiry_date DATETIME,
    nameservers JSON,
    ssl_valid BOOLEAN DEFAULT FALSE,
    ssl_issuer VARCHAR(255),
    ssl_expiry DATETIME,
    
    -- Risk Assessment
    risk_level ENUM('safe', 'low', 'medium', 'high', 'critical') DEFAULT 'safe',
    risk_factors JSON,
    last_risk_assessment DATETIME,
    
    -- Category Classification (NEW)
    category VARCHAR(50) DEFAULT 'unknown',
    sub_category VARCHAR(50),
    industry VARCHAR(50),
    notes TEXT, -- Manual review notes
    
    -- Block Status
    is_blocked BOOLEAN DEFAULT FALSE,
    block_reason TEXT,
    blocked_at DATETIME,
    blocked_by INT DEFAULT NULL,
    
    -- Audit Columns
    created_by INT DEFAULT NULL,
    updated_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP DEFAULT NULL,
    is_deleted TINYINT(1) DEFAULT 0,
    
    -- Indexes
    INDEX idx_domain (domain),
    INDEX idx_domain_hash (domain_hash),
    INDEX idx_trust_score (trust_score),
    INDEX idx_risk_level (risk_level),
    INDEX idx_is_blocked (is_blocked),
    INDEX idx_created_at (created_at),
    INDEX idx_deleted (is_deleted),
    INDEX idx_ssl_valid (ssl_valid),
    INDEX idx_category (category), -- NEW
    
    -- Composite Indexes
    INDEX idx_trust_risk (trust_score, risk_level),
    INDEX idx_blocked_status (is_blocked, risk_level),
    INDEX idx_ssl_trust (ssl_valid, trust_score),
    INDEX idx_category_risk (category, risk_level) -- NEW
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SUSPICIOUS REDIRECTS
-- ============================================

CREATE TABLE IF NOT EXISTS suspicious_redirects (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    -- Redirect Information
    from_url VARCHAR(2000) NOT NULL,
    from_domain VARCHAR(255) GENERATED ALWAYS AS (REGEXP_SUBSTR(from_url, '^(?:https?:\/\/)?([^\/]+)')) STORED,
    to_url VARCHAR(2000),
    to_domain VARCHAR(255) GENERATED ALWAYS AS (REGEXP_SUBSTR(to_url, '^(?:https?:\/\/)?([^\/]+)')) STORED,
    
    -- IP Tracking (NEW)
    ip_address VARCHAR(45),
    user_agent TEXT,
    
    -- Redirect Details
    redirect_type ENUM('301', '302', '303', '307', '308', 'meta', 'javascript') DEFAULT '301',
    reason TEXT,
    detection_method VARCHAR(100),
    
    -- Risk Assessment
    is_malicious BOOLEAN DEFAULT FALSE,
    is_suspicious BOOLEAN DEFAULT TRUE,
    risk_score INT DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
    threat_categories JSON,
    
    -- Chain Tracking
    redirect_chain JSON,
    chain_length INT DEFAULT 0,
    is_chain_complete BOOLEAN DEFAULT FALSE,
    
    -- Audit Columns
    created_by INT DEFAULT NULL,
    updated_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP DEFAULT NULL,
    is_deleted TINYINT(1) DEFAULT 0,
    
    -- Indexes
    INDEX idx_from_url (from_url(255)),
    INDEX idx_from_domain (from_domain),
    INDEX idx_to_domain (to_domain),
    INDEX idx_redirect_type (redirect_type),
    INDEX idx_is_malicious (is_malicious),
    INDEX idx_is_suspicious (is_suspicious),
    INDEX idx_risk_score (risk_score),
    INDEX idx_created_at (created_at),
    INDEX idx_deleted (is_deleted),
    INDEX idx_ip_address (ip_address), -- NEW
    
    -- Composite Indexes
    INDEX idx_malicious_risk (is_malicious, risk_score),
    INDEX idx_domain_risk (from_domain, risk_score),
    INDEX idx_type_suspicious (redirect_type, is_suspicious),
    INDEX idx_ip_malicious (ip_address, is_malicious) -- NEW
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- URL BLACKLIST
-- ============================================

CREATE TABLE IF NOT EXISTS url_blacklist (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    -- URL Information
    url VARCHAR(2000) NOT NULL UNIQUE,
    url_hash CHAR(64) GENERATED ALWAYS AS (SHA2(url, 256)) STORED,
    domain VARCHAR(255) GENERATED ALWAYS AS (REGEXP_SUBSTR(url, '^(?:https?:\/\/)?([^\/]+)')) STORED,
    
    -- Blacklist Details
    reason TEXT,
    category ENUM('phishing', 'malware', 'scam', 'deceptive', 'spam', 'other') DEFAULT 'other',
    severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    
    -- Source Information
    reported_by INT DEFAULT NULL,
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_by INT DEFAULT NULL,
    verified_at DATETIME DEFAULT NULL,
    verification_status ENUM('pending', 'verified', 'rejected', 'expired') DEFAULT 'pending',
    
    -- Whitelist/Blacklist
    is_whitelisted BOOLEAN DEFAULT FALSE,
    whitelist_reason TEXT,
    whitelisted_at DATETIME,
    whitelisted_by INT DEFAULT NULL,
    
    -- Expiration
    expires_at DATETIME DEFAULT NULL,
    is_permanent BOOLEAN DEFAULT FALSE,
    
    -- Audit Columns
    created_by INT DEFAULT NULL,
    updated_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP DEFAULT NULL,
    is_deleted TINYINT(1) DEFAULT 0,
    
    -- Indexes
    INDEX idx_url (url(255)),
    INDEX idx_url_hash (url_hash),
    INDEX idx_domain (domain),
    INDEX idx_category (category),
    INDEX idx_severity (severity),
    INDEX idx_verification_status (verification_status),
    INDEX idx_is_whitelisted (is_whitelisted),
    INDEX idx_expires_at (expires_at),
    INDEX idx_deleted (is_deleted),
    
    -- Composite Indexes
    INDEX idx_category_severity (category, severity),
    INDEX idx_status_whitelisted (verification_status, is_whitelisted),
    INDEX idx_expiry_status (expires_at, verification_status)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- THREAT INTELLIGENCE FEEDS
-- ============================================

CREATE TABLE IF NOT EXISTS threat_intelligence_feeds (
    id INT PRIMARY KEY AUTO_INCREMENT,
    
    -- Feed Information
    feed_name VARCHAR(100) NOT NULL,
    feed_provider VARCHAR(100),
    feed_type ENUM('url', 'domain', 'ip', 'hash') DEFAULT 'url',
    
    -- Feed Data
    feed_data JSON,
    data_hash CHAR(64) GENERATED ALWAYS AS (SHA2(JSON_EXTRACT(feed_data, '$'), 256)) STORED,
    
    -- Processing
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_by INT DEFAULT NULL,
    processing_status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    processing_error TEXT,
    
    -- Schedule
    last_update DATETIME,
    next_update DATETIME,
    update_interval VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Audit Columns
    created_by INT DEFAULT NULL,
    updated_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP DEFAULT NULL,
    is_deleted TINYINT(1) DEFAULT 0,
    
    -- Indexes
    INDEX idx_feed_name (feed_name),
    INDEX idx_feed_type (feed_type),
    INDEX idx_processing_status (processing_status),
    INDEX idx_is_active (is_active),
    INDEX idx_last_update (last_update),
    INDEX idx_deleted (is_deleted)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SUMMARY VIEWS
-- ============================================

-- View for Recent Threats
CREATE OR REPLACE VIEW recent_threats AS
SELECT 
    id,
    url,
    domain,
    ip_address,
    trust_score,
    threat_level,
    validation_status,
    is_phishing,
    is_malware,
    is_scam,
    is_malicious,
    created_at
FROM webdecept_validation_logs
WHERE is_deleted = 0
    AND (is_phishing = TRUE 
         OR is_malware = TRUE 
         OR is_scam = TRUE 
         OR is_malicious = TRUE
         OR threat_level IN ('high', 'critical'))
ORDER BY created_at DESC
LIMIT 1000;

-- View for Domain Reputation Summary
CREATE OR REPLACE VIEW domain_reputation_summary AS
SELECT 
    domain,
    trust_score,
    security_score,
    risk_level,
    category,
    is_blocked,
    violation_count,
    total_checks,
    suspicious_count,
    malicious_count,
    created_at,
    updated_at
FROM domain_reputation
WHERE is_deleted = 0
ORDER BY trust_score ASC;

-- View for Suspicious Activity
CREATE OR REPLACE VIEW suspicious_activity AS
SELECT 
    id,
    from_url,
    from_domain,
    to_url,
    to_domain,
    redirect_type,
    is_malicious,
    risk_score,
    ip_address,
    created_at
FROM suspicious_redirects
WHERE is_deleted = 0
    AND (is_malicious = TRUE OR risk_score > 50)
ORDER BY created_at DESC
LIMIT 500;

-- View for Active Blacklist
CREATE OR REPLACE VIEW active_blacklist AS
SELECT 
    id,
    url,
    domain,
    category,
    severity,
    reason,
    reported_at,
    verified_at,
    verification_status,
    expires_at
FROM url_blacklist
WHERE is_deleted = 0
    AND is_whitelisted = FALSE
    AND verification_status = 'verified'
    AND (expires_at IS NULL OR expires_at > NOW())
ORDER BY severity DESC, created_at DESC;

-- ============================================
-- STORED PROCEDURES
-- ============================================

DELIMITER //

-- 1. Check URL Against Blacklist
CREATE PROCEDURE CheckURLBlacklist(
    IN p_url VARCHAR(2000),
    OUT p_is_blacklisted BOOLEAN,
    OUT p_category VARCHAR(50),
    OUT p_severity VARCHAR(20),
    OUT p_message VARCHAR(255)
)
BEGIN
    DECLARE v_count INT;
    DECLARE v_category VARCHAR(50);
    DECLARE v_severity VARCHAR(20);
    
    SELECT 
        COUNT(*), 
        category, 
        severity
    INTO 
        v_count, 
        v_category, 
        v_severity
    FROM url_blacklist
    WHERE url = p_url
        AND is_deleted = 0
        AND is_whitelisted = FALSE
        AND verification_status = 'verified'
        AND (expires_at IS NULL OR expires_at > NOW());
    
    IF v_count > 0 THEN
        SET p_is_blacklisted = TRUE;
        SET p_category = v_category;
        SET p_severity = v_severity;
        SET p_message = CONCAT('URL is blacklisted as ', v_category, ' (', v_severity, ' severity)');
    ELSE
        SET p_is_blacklisted = FALSE;
        SET p_category = NULL;
        SET p_severity = NULL;
        SET p_message = 'URL is not blacklisted';
    END IF;
END //

-- 2. Update Domain Reputation
CREATE PROCEDURE UpdateDomainReputation(
    IN p_domain VARCHAR(255),
    IN p_trust_score INT,
    IN p_is_malicious BOOLEAN,
    IN p_validation_status VARCHAR(20)
)
BEGIN
    DECLARE v_exists INT;
    
    -- Check if domain exists
    SELECT COUNT(*) INTO v_exists 
    FROM domain_reputation 
    WHERE domain = p_domain AND is_deleted = 0;
    
    START TRANSACTION;
    
    IF v_exists > 0 THEN
        -- Update existing domain
        UPDATE domain_reputation 
        SET 
            trust_score = (trust_score + p_trust_score) / 2,
            total_checks = total_checks + 1,
            suspicious_count = suspicious_count + 
                CASE WHEN p_validation_status IN ('suspicious', 'malicious') THEN 1 ELSE 0 END,
            malicious_count = malicious_count + 
                CASE WHEN p_is_malicious = TRUE THEN 1 ELSE 0 END,
            updated_at = NOW(),
            risk_level = CASE 
                WHEN trust_score < 20 THEN 'critical'
                WHEN trust_score < 40 THEN 'high'
                WHEN trust_score < 60 THEN 'medium'
                WHEN trust_score < 80 THEN 'low'
                ELSE 'safe'
            END
        WHERE domain = p_domain;
    ELSE
        -- Insert new domain
        INSERT INTO domain_reputation (
            domain,
            trust_score,
            total_checks,
            suspicious_count,
            malicious_count,
            risk_level
        ) VALUES (
            p_domain,
            p_trust_score,
            1,
            CASE WHEN p_validation_status IN ('suspicious', 'malicious') THEN 1 ELSE 0 END,
            CASE WHEN p_is_malicious = TRUE THEN 1 ELSE 0 END,
            CASE 
                WHEN p_trust_score < 20 THEN 'critical'
                WHEN p_trust_score < 40 THEN 'high'
                WHEN p_trust_score < 60 THEN 'medium'
                WHEN p_trust_score < 80 THEN 'low'
                ELSE 'safe'
            END
        );
    END IF;
    
    COMMIT;
END //

-- 3. Clean Expired Blacklist Entries
CREATE PROCEDURE CleanExpiredBlacklist()
BEGIN
    START TRANSACTION;
    
    -- Soft delete expired entries
    UPDATE url_blacklist 
    SET 
        is_deleted = 1,
        deleted_at = NOW(),
        updated_at = NOW()
    WHERE expires_at IS NOT NULL 
        AND expires_at < NOW() 
        AND is_permanent = FALSE
        AND is_deleted = 0;
    
    COMMIT;
END //

-- 4. Get Domain Threat Statistics
CREATE PROCEDURE GetDomainThreatStats(
    IN p_domain VARCHAR(255)
)
BEGIN
    SELECT 
        COUNT(*) as total_checks,
        SUM(CASE WHEN threat_level IN ('high', 'critical') THEN 1 ELSE 0 END) as high_threats,
        SUM(CASE WHEN is_phishing = TRUE THEN 1 ELSE 0 END) as phishing_count,
        SUM(CASE WHEN is_malware = TRUE THEN 1 ELSE 0 END) as malware_count,
        AVG(trust_score) as avg_trust_score,
        MIN(trust_score) as min_trust_score,
        MAX(trust_score) as max_trust_score
    FROM webdecept_validation_logs
    WHERE domain = p_domain
        AND is_deleted = 0
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY);
END //

-- 5. Archive Old Validation Logs
CREATE PROCEDURE ArchiveOldValidationLogs()
BEGIN
    DECLARE v_archive_date DATETIME;
    SET v_archive_date = DATE_SUB(NOW(), INTERVAL 6 MONTH);
    
    START TRANSACTION;
    
    -- Archive logs older than 6 months
    INSERT INTO webdecept_validation_logs_archive 
    SELECT * FROM webdecept_validation_logs 
    WHERE created_at < v_archive_date 
        AND is_deleted = 1;
    
    -- Delete archived records
    DELETE FROM webdecept_validation_logs 
    WHERE created_at < v_archive_date 
        AND is_deleted = 1;
    
    COMMIT;
END //

-- 6. Get IP Threat Statistics (NEW)
CREATE PROCEDURE GetIPThreatStats(
    IN p_ip_address VARCHAR(45)
)
BEGIN
    SELECT 
        COUNT(*) as total_checks,
        SUM(CASE WHEN threat_level IN ('high', 'critical') THEN 1 ELSE 0 END) as high_threats,
        SUM(CASE WHEN is_malicious = TRUE THEN 1 ELSE 0 END) as malicious_count,
        AVG(trust_score) as avg_trust_score
    FROM webdecept_validation_logs
    WHERE ip_address = p_ip_address
        AND is_deleted = 0
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY);
END //

-- 7. Get Dashboard Summary (NEW)
CREATE PROCEDURE GetDashboardSummary()
BEGIN
    -- Total threats today
    SELECT 
        COUNT(*) as total_threats,
        SUM(CASE WHEN threat_level = 'critical' THEN 1 ELSE 0 END) as critical_threats,
        SUM(CASE WHEN threat_level = 'high' THEN 1 ELSE 0 END) as high_threats,
        SUM(CASE WHEN is_phishing = TRUE THEN 1 ELSE 0 END) as phishing_attempts,
        SUM(CASE WHEN is_malware = TRUE THEN 1 ELSE 0 END) as malware_attempts
    FROM webdecept_validation_logs
    WHERE DATE(created_at) = CURDATE()
        AND is_deleted = 0;
        
    -- Top malicious domains
    SELECT 
        domain,
        COUNT(*) as count,
        AVG(trust_score) as avg_trust
    FROM webdecept_validation_logs
    WHERE is_malicious = TRUE
        AND is_deleted = 0
        AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY domain
    ORDER BY count DESC
    LIMIT 10;
END //

DELIMITER ;

-- ============================================
-- TRIGGERS
-- ============================================

DELIMITER //

-- Trigger to update domain reputation on validation
CREATE TRIGGER after_validation_log_insert
AFTER INSERT ON webdecept_validation_logs
FOR EACH ROW
BEGIN
    -- Update domain reputation if domain exists
    IF NEW.domain IS NOT NULL AND NEW.trust_score IS NOT NULL THEN
        CALL UpdateDomainReputation(
            NEW.domain,
            NEW.trust_score,
            NEW.is_malicious,
            NEW.validation_status
        );
    END IF;
END //

-- Trigger to log suspicious redirects automatically
CREATE TRIGGER after_suspicious_redirect_insert
AFTER INSERT ON suspicious_redirects
FOR EACH ROW
BEGIN
    -- Check if destination domain is blacklisted
    IF NEW.to_domain IS NOT NULL THEN
        UPDATE suspicious_redirects 
        SET 
            is_malicious = EXISTS (
                SELECT 1 
                FROM url_blacklist 
                WHERE domain = NEW.to_domain 
                    AND is_deleted = 0 
                    AND is_whitelisted = FALSE
                    AND verification_status = 'verified'
            ),
            risk_score = CASE 
                WHEN EXISTS (
                    SELECT 1 
                    FROM url_blacklist 
                    WHERE domain = NEW.to_domain 
                        AND severity IN ('high', 'critical')
                ) THEN 80
                ELSE 50
            END
        WHERE id = NEW.id;
    END IF;
END //

-- NEW: Trigger to auto-update malicious flag
CREATE TRIGGER before_validation_log_insert
BEFORE INSERT ON webdecept_validation_logs
FOR EACH ROW
BEGIN
    -- Auto-set malicious flag
    SET NEW.is_malicious = (NEW.is_phishing OR NEW.is_malware OR NEW.is_scam OR NEW.is_deceptive);
    
    -- Auto-set validation method if not provided
    IF NEW.validation_method IS NULL THEN
        SET NEW.validation_method = 'auto';
    END IF;
END //

DELIMITER ;

-- ============================================
-- SCHEDULED EVENTS
-- ============================================

-- Enable event scheduler
-- SET GLOBAL event_scheduler = ON;

DELIMITER //

-- Clean expired blacklist daily
CREATE EVENT IF NOT EXISTS clean_expired_blacklist_event
ON SCHEDULE EVERY 1 DAY
DO
BEGIN
    CALL CleanExpiredBlacklist();
END //

-- Archive old logs weekly
CREATE EVENT IF NOT EXISTS archive_old_logs_event
ON SCHEDULE EVERY 1 WEEK
DO
BEGIN
    CALL ArchiveOldValidationLogs();
END //

-- NEW: Weekly stats cleanup
CREATE EVENT IF NOT EXISTS weekly_stats_cleanup
ON SCHEDULE EVERY 1 WEEK
DO
BEGIN
    -- Delete old suspicious redirects (older than 3 months)
    UPDATE suspicious_redirects 
    SET is_deleted = 1, deleted_at = NOW()
    WHERE created_at < DATE_SUB(NOW(), INTERVAL 3 MONTH)
        AND is_deleted = 0
        AND is_malicious = FALSE;
END //

DELIMITER ;

-- ============================================
-- ARCHIVE TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS webdecept_validation_logs_archive (
    id INT,
    url VARCHAR(2000),
    trust_score INT,
    validation_status VARCHAR(20),
    flags JSON,
    warnings JSON,
    context JSON,
    features JSON,
    threat_level VARCHAR(20),
    is_phishing BOOLEAN,
    is_malware BOOLEAN,
    is_scam BOOLEAN,
    is_malicious BOOLEAN,
    ip_address VARCHAR(45),
    created_at TIMESTAMP,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_archive_created (created_at),
    INDEX idx_archive_archived (archived_at),
    INDEX idx_archive_ip (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS domain_reputation_archive (
    id INT,
    domain VARCHAR(255),
    trust_score INT,
    risk_level VARCHAR(20),
    category VARCHAR(50),
    violation_count INT,
    total_checks INT,
    created_at TIMESTAMP,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_archive_domain (domain),
    INDEX idx_archive_archived (archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SAMPLE DATA (Optional)
-- ============================================

-- Insert sample domains
INSERT INTO domain_reputation (domain, trust_score, risk_level, category) VALUES
('example.com', 95, 'safe', 'ecommerce'),
('suspicious-site.com', 30, 'high', 'phishing'),
('malware-site.com', 10, 'critical', 'malware');

-- Insert sample blacklist entries
INSERT INTO url_blacklist (url, category, severity, verification_status) VALUES
('https://phishing-site.com/fake-login', 'phishing', 'high', 'verified'),
('https://malware-site.com/download', 'malware', 'critical', 'verified'),
('https://scam-site.com/fake-offer', 'scam', 'medium', 'verified');

-- ============================================
-- END OF SCHEMA
-- ============================================