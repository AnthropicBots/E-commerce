-- backend/scripts/promo_schema.sql
CREATE TABLE IF NOT EXISTS promo_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    discount_type ENUM('percentage', 'fixed') NOT NULL,
    discount_value DECIMAL(10,2) NOT NULL,
    minimum_order_amount DECIMAL(10,2) DEFAULT 0.00,
    maximum_discount DECIMAL(10,2) DEFAULT NULL,
    start_date DATETIME NOT NULL,
    expiry_date DATETIME NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    allow_stacking TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CHECK (discount_value >= 0),
    CHECK (minimum_order_amount >= 0)
);

DELIMITER //

CREATE PROCEDURE AddPromoColumnsToOrders()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'promo_code'
    ) THEN
        ALTER TABLE orders 
        ADD COLUMN promo_code VARCHAR(50) DEFAULT NULL,
        ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0.00,
        ADD COLUMN subtotal DECIMAL(10,2) DEFAULT 0.00,
        ADD COLUMN final_amount DECIMAL(10,2) DEFAULT 0.00;
    END IF;
END //

DELIMITER ;

CALL AddPromoColumnsToOrders();
DROP PROCEDURE AddPromoColumnsToOrders;
