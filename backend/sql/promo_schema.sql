-- backend/sql/promo_schema.sql

-- ============================================
-- PROMO CODES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS promo_codes (
    -- Primary Key
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Promo Code Details
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    discount_type ENUM('percentage', 'fixed', 'free_shipping') NOT NULL DEFAULT 'percentage',
    discount_value DECIMAL(10,2) NOT NULL CHECK (discount_value >= 0),
    
    -- Constraints
    minimum_order_amount DECIMAL(10,2) DEFAULT 0.00 CHECK (minimum_order_amount >= 0),
    maximum_discount DECIMAL(10,2) DEFAULT NULL CHECK (maximum_discount >= 0),
    usage_limit INT DEFAULT NULL CHECK (usage_limit >= 0),
    usage_count INT DEFAULT 0 CHECK (usage_count >= 0),
    per_user_limit INT DEFAULT 1 CHECK (per_user_limit >= 0),
    
    -- Date Range
    start_date DATETIME NOT NULL,
    expiry_date DATETIME NOT NULL,
    CHECK (expiry_date > start_date),
    
    -- Restrictions
    applicable_categories TEXT DEFAULT NULL, -- JSON array of category IDs
    applicable_products TEXT DEFAULT NULL, -- JSON array of product IDs
    excluded_categories TEXT DEFAULT NULL,
    excluded_products TEXT DEFAULT NULL,
    
    -- Features
    is_active TINYINT(1) DEFAULT 1,
    is_deleted TINYINT(1) DEFAULT 0,
    allow_stacking TINYINT(1) DEFAULT 0,
    allow_combine TINYINT(1) DEFAULT 0,
    is_public TINYINT(1) DEFAULT 1,
    is_auto_applied TINYINT(1) DEFAULT 0,
    
    -- Who created/updated
    created_by INT DEFAULT NULL,
    updated_by INT DEFAULT NULL,
    
    -- Audit Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP DEFAULT NULL,
    
    -- Foreign Keys
    INDEX idx_created_by (created_by),
    INDEX idx_updated_by (updated_by),
    INDEX idx_deleted_at (deleted_at)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Composite Indexes for Common Queries
CREATE INDEX idx_promo_code_active_range ON promo_codes (code, is_active, start_date, expiry_date);
CREATE INDEX idx_promo_code_date_range ON promo_codes (start_date, expiry_date, is_active);
CREATE INDEX idx_promo_code_discount ON promo_codes (discount_type, discount_value, is_active);
CREATE INDEX idx_promo_code_usage ON promo_codes (usage_limit, usage_count, is_active);
CREATE INDEX idx_promo_code_deleted ON promo_codes (is_deleted, is_active);

-- Index for code lookups
CREATE INDEX idx_promo_code_lookup ON promo_codes (code, is_active, is_deleted);

-- Index for expiry checks
CREATE INDEX idx_promo_code_expiry ON promo_codes (expiry_date, is_active);

-- ============================================
-- PROMO USAGE TRACKING TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS promo_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    promo_id INT NOT NULL,
    user_id INT NOT NULL,
    order_id INT NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL CHECK (discount_amount >= 0),
    
    -- Status
    status ENUM('pending', 'applied', 'cancelled', 'expired', 'failed') DEFAULT 'pending',
    
    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign Keys
    INDEX idx_promo_usage_promo (promo_id),
    INDEX idx_promo_usage_user (user_id),
    INDEX idx_promo_usage_order (order_id),
    INDEX idx_promo_usage_status (status),
    INDEX idx_promo_usage_created (created_at),
    
    -- Composite Indexes
    INDEX idx_promo_usage_promo_user (promo_id, user_id),
    INDEX idx_promo_usage_order_status (order_id, status),
    
    FOREIGN KEY (promo_id) REFERENCES promo_codes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- PROMO BATCH TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS promo_batches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_name VARCHAR(100) NOT NULL,
    batch_description TEXT,
    
    -- Batch Details
    total_codes INT NOT NULL CHECK (total_codes > 0),
    generated_codes INT DEFAULT 0,
    used_codes INT DEFAULT 0,
    
    -- Common Settings
    discount_type ENUM('percentage', 'fixed', 'free_shipping') NOT NULL DEFAULT 'percentage',
    discount_value DECIMAL(10,2) NOT NULL CHECK (discount_value >= 0),
    minimum_order_amount DECIMAL(10,2) DEFAULT 0.00,
    maximum_discount DECIMAL(10,2) DEFAULT NULL,
    start_date DATETIME NOT NULL,
    expiry_date DATETIME NOT NULL,
    
    -- Status
    status ENUM('draft', 'generating', 'ready', 'active', 'expired', 'cancelled') DEFAULT 'draft',
    
    -- Audit
    created_by INT DEFAULT NULL,
    updated_by INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_batch_status (status),
    INDEX idx_batch_date_range (start_date, expiry_date),
    INDEX idx_batch_created_by (created_by),
    INDEX idx_batch_updated_by (updated_by)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- PROMO CODE GENERATION HISTORY
-- ============================================

CREATE TABLE IF NOT EXISTS promo_generation_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch_id INT NOT NULL,
    promo_code VARCHAR(50) NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    generated_by INT DEFAULT NULL,
    
    INDEX idx_generation_batch (batch_id),
    INDEX idx_generation_code (promo_code),
    INDEX idx_generation_created (generated_at),
    
    FOREIGN KEY (batch_id) REFERENCES promo_batches(id) ON DELETE CASCADE
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- STORED PROCEDURES
-- ============================================

DELIMITER //

-- 1. Procedure to Validate Promo Code
CREATE PROCEDURE ValidatePromoCode(
    IN p_code VARCHAR(50),
    IN p_user_id INT,
    IN p_order_amount DECIMAL(10,2),
    OUT p_is_valid BOOLEAN,
    OUT p_discount_amount DECIMAL(10,2),
    OUT p_message VARCHAR(255)
)
BEGIN
    DECLARE v_discount_type ENUM('percentage', 'fixed', 'free_shipping');
    DECLARE v_discount_value DECIMAL(10,2);
    DECLARE v_minimum_order DECIMAL(10,2);
    DECLARE v_max_discount DECIMAL(10,2);
    DECLARE v_usage_limit INT;
    DECLARE v_usage_count INT;
    DECLARE v_per_user_limit INT;
    DECLARE v_start_date DATETIME;
    DECLARE v_expiry_date DATETIME;
    DECLARE v_is_active TINYINT(1);
    DECLARE v_user_usage INT;
    
    SET p_is_valid = FALSE;
    SET p_discount_amount = 0;
    SET p_message = '';
    
    -- Check if promo code exists and is active
    SELECT 
        discount_type, discount_value, minimum_order_amount, 
        maximum_discount, usage_limit, usage_count, per_user_limit,
        start_date, expiry_date, is_active
    INTO 
        v_discount_type, v_discount_value, v_minimum_order,
        v_max_discount, v_usage_limit, v_usage_count, v_per_user_limit,
        v_start_date, v_expiry_date, v_is_active
    FROM promo_codes 
    WHERE code = p_code AND is_deleted = 0;
    
    -- If no code found
    IF v_discount_type IS NULL THEN
        SET p_message = 'Invalid promo code';
        SET p_is_valid = FALSE;
        RETURN;
    END IF;
    
    -- Check if promo is active
    IF v_is_active = 0 THEN
        SET p_message = 'Promo code is inactive';
        SET p_is_valid = FALSE;
        RETURN;
    END IF;
    
    -- Check date range
    IF NOW() < v_start_date THEN
        SET p_message = 'Promo code is not yet active';
        SET p_is_valid = FALSE;
        RETURN;
    END IF;
    
    IF NOW() > v_expiry_date THEN
        SET p_message = 'Promo code has expired';
        SET p_is_valid = FALSE;
        RETURN;
    END IF;
    
    -- Check minimum order amount
    IF p_order_amount < v_minimum_order THEN
        SET p_message = CONCAT('Minimum order amount is ', v_minimum_order);
        SET p_is_valid = FALSE;
        RETURN;
    END IF;
    
    -- Check usage limit
    IF v_usage_limit IS NOT NULL AND v_usage_count >= v_usage_limit THEN
        SET p_message = 'Promo code usage limit exceeded';
        SET p_is_valid = FALSE;
        RETURN;
    END IF;
    
    -- Check per user limit
    IF p_user_id IS NOT NULL AND v_per_user_limit IS NOT NULL THEN
        SELECT COUNT(*) INTO v_user_usage 
        FROM promo_usage 
        WHERE promo_id = (SELECT id FROM promo_codes WHERE code = p_code)
        AND user_id = p_user_id
        AND status IN ('pending', 'applied');
        
        IF v_user_usage >= v_per_user_limit THEN
            SET p_message = 'You have reached the usage limit for this promo';
            SET p_is_valid = FALSE;
            RETURN;
        END IF;
    END IF;
    
    -- Calculate discount
    IF v_discount_type = 'percentage' THEN
        SET p_discount_amount = (p_order_amount * v_discount_value) / 100;
        IF v_max_discount IS NOT NULL AND p_discount_amount > v_max_discount THEN
            SET p_discount_amount = v_max_discount;
        END IF;
    ELSEIF v_discount_type = 'fixed' THEN
        SET p_discount_amount = v_discount_value;
        IF p_discount_amount > p_order_amount THEN
            SET p_discount_amount = p_order_amount;
        END IF;
    ELSEIF v_discount_type = 'free_shipping' THEN
        SET p_discount_amount = 0;
    END IF;
    
    SET p_is_valid = TRUE;
    SET p_message = 'Valid promo code';
END //

-- 2. Procedure to Apply Promo Code
CREATE PROCEDURE ApplyPromoCode(
    IN p_code VARCHAR(50),
    IN p_user_id INT,
    IN p_order_id INT,
    OUT p_success BOOLEAN,
    OUT p_message VARCHAR(255)
)
BEGIN
    DECLARE v_promo_id INT;
    DECLARE v_discount_amount DECIMAL(10,2);
    DECLARE v_order_amount DECIMAL(10,2);
    DECLARE v_is_valid BOOLEAN;
    DECLARE v_valid_message VARCHAR(255);
    
    -- Get order amount
    SELECT final_amount INTO v_order_amount 
    FROM orders 
    WHERE id = p_order_id;
    
    -- Validate promo
    CALL ValidatePromoCode(p_code, p_user_id, v_order_amount, v_is_valid, v_discount_amount, v_valid_message);
    
    IF NOT v_is_valid THEN
        SET p_success = FALSE;
        SET p_message = v_valid_message;
        RETURN;
    END IF;
    
    -- Get promo ID
    SELECT id INTO v_promo_id FROM promo_codes WHERE code = p_code AND is_deleted = 0;
    
    -- Start transaction
    START TRANSACTION;
    
    -- Update promo usage count
    UPDATE promo_codes 
    SET usage_count = usage_count + 1 
    WHERE id = v_promo_id;
    
    -- Insert usage record
    INSERT INTO promo_usage (promo_id, user_id, order_id, discount_amount, status)
    VALUES (v_promo_id, p_user_id, p_order_id, v_discount_amount, 'applied');
    
    -- Update order with discount
    UPDATE orders 
    SET 
        promo_code = p_code,
        discount_amount = v_discount_amount,
        final_amount = final_amount - v_discount_amount
    WHERE id = p_order_id;
    
    COMMIT;
    
    SET p_success = TRUE;
    SET p_message = 'Promo code applied successfully';
END //

-- 3. Procedure to Get Active Promos
CREATE PROCEDURE GetActivePromos(
    IN p_user_id INT,
    IN p_order_amount DECIMAL(10,2)
)
BEGIN
    SELECT 
        id,
        code,
        discount_type,
        discount_value,
        minimum_order_amount,
        maximum_discount,
        start_date,
        expiry_date,
        description,
        per_user_limit,
        usage_limit,
        usage_count
    FROM promo_codes
    WHERE is_active = 1 
        AND is_deleted = 0
        AND start_date <= NOW()
        AND expiry_date >= NOW()
        AND (usage_limit IS NULL OR usage_count < usage_limit)
        AND (minimum_order_amount IS NULL OR minimum_order_amount <= p_order_amount)
        AND (per_user_limit IS NULL OR 
            (SELECT COUNT(*) FROM promo_usage 
             WHERE promo_id = promo_codes.id 
             AND user_id = p_user_id 
             AND status IN ('pending', 'applied')) < per_user_limit)
    ORDER BY start_date ASC;
END //

-- 4. Procedure to Clean Expired Promos
CREATE PROCEDURE CleanExpiredPromos()
BEGIN
    START TRANSACTION;
    
    -- Soft delete expired promos
    UPDATE promo_codes 
    SET 
        is_active = 0,
        updated_at = NOW()
    WHERE expiry_date < NOW() 
        AND is_active = 1 
        AND is_deleted = 0;
    
    -- Update usage records
    UPDATE promo_usage 
    SET 
        status = 'expired',
        updated_at = NOW()
    WHERE status = 'pending' 
        AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY);
    
    COMMIT;
END //

-- 5. Procedure to Generate Bulk Promo Codes
CREATE PROCEDURE GenerateBulkPromoCodes(
    IN p_batch_id INT,
    IN p_count INT
)
BEGIN
    DECLARE v_counter INT DEFAULT 0;
    DECLARE v_code VARCHAR(50);
    DECLARE v_promo_id INT;
    DECLARE v_batch_discount_type VARCHAR(20);
    DECLARE v_batch_discount_value DECIMAL(10,2);
    DECLARE v_batch_minimum_order DECIMAL(10,2);
    DECLARE v_batch_max_discount DECIMAL(10,2);
    DECLARE v_batch_start_date DATETIME;
    DECLARE v_batch_expiry_date DATETIME;
    
    -- Get batch settings
    SELECT 
        discount_type, discount_value, minimum_order_amount,
        maximum_discount, start_date, expiry_date
    INTO 
        v_batch_discount_type, v_batch_discount_value, v_batch_minimum_order,
        v_batch_max_discount, v_batch_start_date, v_batch_expiry_date
    FROM promo_batches 
    WHERE id = p_batch_id;
    
    START TRANSACTION;
    
    WHILE v_counter < p_count DO
        -- Generate unique code
        SET v_code = CONCAT(
            UPPER(SUBSTRING(MD5(RAND()), 1, 4)),
            '-',
            UPPER(SUBSTRING(MD5(RAND()), 1, 4)),
            '-',
            UPPER(SUBSTRING(MD5(RAND()), 1, 4))
        );
        
        -- Insert promo code
        INSERT INTO promo_codes (
            code, 
            discount_type, 
            discount_value, 
            minimum_order_amount,
            maximum_discount,
            start_date,
            expiry_date,
            is_active,
            created_by
        ) VALUES (
            v_code,
            v_batch_discount_type,
            v_batch_discount_value,
            v_batch_minimum_order,
            v_batch_max_discount,
            v_batch_start_date,
            v_batch_expiry_date,
            1,
            (SELECT created_by FROM promo_batches WHERE id = p_batch_id)
        );
        
        SET v_promo_id = LAST_INSERT_ID();
        
        -- Record generation history
        INSERT INTO promo_generation_history (batch_id, promo_code)
        VALUES (p_batch_id, v_code);
        
        SET v_counter = v_counter + 1;
    END WHILE;
    
    -- Update batch status
    UPDATE promo_batches 
    SET 
        generated_codes = generated_codes + p_count,
        status = CASE 
            WHEN generated_codes >= total_codes THEN 'ready' 
            ELSE 'generating' 
        END,
        updated_at = NOW()
    WHERE id = p_batch_id;
    
    COMMIT;
END //

-- 6. Procedure to Archive Old Promo Data
CREATE PROCEDURE ArchiveOldPromoData()
BEGIN
    DECLARE v_archive_date DATETIME;
    SET v_archive_date = DATE_SUB(NOW(), INTERVAL 1 YEAR);
    
    START TRANSACTION;
    
    -- Archive promo usage older than 1 year
    INSERT INTO promo_usage_archive 
    SELECT * FROM promo_usage 
    WHERE created_at < v_archive_date;
    
    -- Delete archived records from main table
    DELETE FROM promo_usage 
    WHERE created_at < v_archive_date;
    
    -- Archive promo codes older than 2 years
    INSERT INTO promo_codes_archive 
    SELECT * FROM promo_codes 
    WHERE created_at < DATE_SUB(NOW(), INTERVAL 2 YEAR)
    AND is_deleted = 1;
    
    -- Delete archived promo codes
    DELETE FROM promo_codes 
    WHERE created_at < DATE_SUB(NOW(), INTERVAL 2 YEAR)
    AND is_deleted = 1;
    
    COMMIT;
END //

DELIMITER ;

-- ============================================
-- TRIGGERS
-- ============================================

DELIMITER //

-- Trigger to validate promo before insert/update
CREATE TRIGGER before_promo_insert_update
BEFORE INSERT ON promo_codes
FOR EACH ROW
BEGIN
    -- Ensure expiry date is after start date
    IF NEW.expiry_date <= NEW.start_date THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Expiry date must be after start date';
    END IF;
    
    -- Validate discount value
    IF NEW.discount_type = 'percentage' AND NEW.discount_value > 100 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Percentage discount cannot exceed 100%';
    END IF;
    
    -- Ensure minimum order is not negative
    IF NEW.minimum_order_amount < 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Minimum order amount cannot be negative';
    END IF;
END //

-- Trigger to update promo stats
CREATE TRIGGER after_promo_usage_insert
AFTER INSERT ON promo_usage
FOR EACH ROW
BEGIN
    -- Update promo code usage count
    UPDATE promo_codes 
    SET usage_count = usage_count + 1 
    WHERE id = NEW.promo_id;
    
    -- Update user stats if applicable
    -- (Additional logic if needed)
END //

DELIMITER ;

-- ============================================
-- ARCHIVE TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS promo_usage_archive (
    id INT,
    promo_id INT NOT NULL,
    user_id INT NOT NULL,
    order_id INT NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20),
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_archive_promo (promo_id),
    INDEX idx_archive_user (user_id),
    INDEX idx_archive_archived (archived_at)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promo_codes_archive (
    id INT,
    code VARCHAR(50),
    discount_type VARCHAR(20),
    discount_value DECIMAL(10,2),
    minimum_order_amount DECIMAL(10,2),
    maximum_discount DECIMAL(10,2),
    start_date DATETIME,
    expiry_date DATETIME,
    is_active TINYINT(1),
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    deleted_at TIMESTAMP,
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_archive_code (code),
    INDEX idx_archive_archived (archived_at)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- DATA RETENTION POLICY (Scheduled Events)
-- ============================================

-- Note: Enable event scheduler first
-- SET GLOBAL event_scheduler = ON;

DELIMITER //

CREATE EVENT IF NOT EXISTS clean_expired_promos_event
ON SCHEDULE EVERY 1 DAY
DO
BEGIN
    CALL CleanExpiredPromos();
END //

CREATE EVENT IF NOT EXISTS archive_old_promo_data_event
ON SCHEDULE EVERY 1 WEEK
DO
BEGIN
    CALL ArchiveOldPromoData();
END //

DELIMITER ;

-- ============================================
-- MIGRATION FOR EXISTING ORDERS
-- ============================================

DELIMITER //

CREATE PROCEDURE AddPromoColumnsToOrders()
BEGIN
    -- Check if columns exist and add them
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'orders' 
        AND COLUMN_NAME = 'promo_code'
    ) THEN
        ALTER TABLE orders 
        ADD COLUMN promo_code VARCHAR(50) DEFAULT NULL,
        ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0.00 CHECK (discount_amount >= 0);
        
        -- Add index for promo_code
        CREATE INDEX idx_orders_promo_code ON orders(promo_code);
    END IF;
    
    -- Add index for discount_amount if exists
    IF EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'orders' 
        AND COLUMN_NAME = 'discount_amount'
    ) AND NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND INDEX_NAME = 'idx_orders_discount'
    ) THEN
        CREATE INDEX idx_orders_discount ON orders(discount_amount);
    END IF;
END //

DELIMITER ;

-- Run migration
CALL AddPromoColumnsToOrders();
DROP PROCEDURE AddPromoColumnsToOrders;

-- ============================================
-- SAMPLE DATA (Optional)
-- ============================================

-- Insert sample promo codes
INSERT INTO promo_codes (
    code,
    description,
    discount_type,
    discount_value,
    minimum_order_amount,
    maximum_discount,
    start_date,
    expiry_date,
    usage_limit,
    per_user_limit,
    is_active
) VALUES
('WELCOME10', '10% off for new users', 'percentage', 10.00, 0.00, 100.00, NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY), 1000, 1, 1),
('SAVE50', 'Rs. 50 off on orders above Rs. 500', 'fixed', 50.00, 500.00, NULL, NOW(), DATE_ADD(NOW(), INTERVAL 15 DAY), 500, 2, 1),
('FREESHIP', 'Free shipping on all orders', 'free_shipping', 0.00, 0.00, NULL, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), 200, 1, 1);
