-- ============================================
-- Migration: Replace Sequential IDs with UUIDs for Users, Products, and Orders
-- ============================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Add temporary columns to parent tables
ALTER TABLE users ADD COLUMN new_uuid CHAR(36);
ALTER TABLE products ADD COLUMN new_uuid CHAR(36);
ALTER TABLE orders ADD COLUMN new_uuid CHAR(36);

-- 2. Generate UUIDs for existing rows
UPDATE users SET new_uuid = UUID() WHERE new_uuid IS NULL;
UPDATE products SET new_uuid = UUID() WHERE new_uuid IS NULL;
UPDATE orders SET new_uuid = UUID() WHERE new_uuid IS NULL;

ALTER TABLE users MODIFY COLUMN new_uuid CHAR(36) NOT NULL;
ALTER TABLE products MODIFY COLUMN new_uuid CHAR(36) NOT NULL;
ALTER TABLE orders MODIFY COLUMN new_uuid CHAR(36) NOT NULL;

-- 3. Add temporary columns to child tables and backfill
ALTER TABLE products ADD COLUMN seller_id_new CHAR(36);
UPDATE products c JOIN users p ON c.seller_id = p.id SET c.seller_id_new = p.new_uuid WHERE c.seller_id IS NOT NULL;
ALTER TABLE product_variants ADD COLUMN product_id_new CHAR(36);
UPDATE product_variants c JOIN products p ON c.product_id = p.id SET c.product_id_new = p.new_uuid WHERE c.product_id IS NOT NULL;
ALTER TABLE orders ADD COLUMN user_id_new CHAR(36);
UPDATE orders c JOIN users p ON c.user_id = p.id SET c.user_id_new = p.new_uuid WHERE c.user_id IS NOT NULL;
ALTER TABLE order_items ADD COLUMN order_id_new CHAR(36);
UPDATE order_items c JOIN orders p ON c.order_id = p.id SET c.order_id_new = p.new_uuid WHERE c.order_id IS NOT NULL;
ALTER TABLE order_items ADD COLUMN product_id_new CHAR(36);
UPDATE order_items c JOIN products p ON c.product_id = p.id SET c.product_id_new = p.new_uuid WHERE c.product_id IS NOT NULL;
ALTER TABLE inventory_transactions ADD COLUMN product_id_new CHAR(36);
UPDATE inventory_transactions c JOIN products p ON c.product_id = p.id SET c.product_id_new = p.new_uuid WHERE c.product_id IS NOT NULL;
ALTER TABLE inventory_transactions ADD COLUMN order_id_new CHAR(36);
UPDATE inventory_transactions c JOIN orders p ON c.order_id = p.id SET c.order_id_new = p.new_uuid WHERE c.order_id IS NOT NULL;
ALTER TABLE inventory_transactions ADD COLUMN created_by_new CHAR(36);
UPDATE inventory_transactions c JOIN users p ON c.created_by = p.id SET c.created_by_new = p.new_uuid WHERE c.created_by IS NOT NULL;
ALTER TABLE inventory_alerts ADD COLUMN product_id_new CHAR(36);
UPDATE inventory_alerts c JOIN products p ON c.product_id = p.id SET c.product_id_new = p.new_uuid WHERE c.product_id IS NOT NULL;
ALTER TABLE inventory_alerts ADD COLUMN resolved_by_new CHAR(36);
UPDATE inventory_alerts c JOIN users p ON c.resolved_by = p.id SET c.resolved_by_new = p.new_uuid WHERE c.resolved_by IS NOT NULL;
ALTER TABLE coupon_usage ADD COLUMN user_id_new CHAR(36);
UPDATE coupon_usage c JOIN users p ON c.user_id = p.id SET c.user_id_new = p.new_uuid WHERE c.user_id IS NOT NULL;
ALTER TABLE coupon_usage ADD COLUMN order_id_new CHAR(36);
UPDATE coupon_usage c JOIN orders p ON c.order_id = p.id SET c.order_id_new = p.new_uuid WHERE c.order_id IS NOT NULL;
ALTER TABLE shipments ADD COLUMN order_id_new CHAR(36);
UPDATE shipments c JOIN orders p ON c.order_id = p.id SET c.order_id_new = p.new_uuid WHERE c.order_id IS NOT NULL;
ALTER TABLE shipments ADD COLUMN created_by_new CHAR(36);
UPDATE shipments c JOIN users p ON c.created_by = p.id SET c.created_by_new = p.new_uuid WHERE c.created_by IS NOT NULL;
ALTER TABLE payment_transactions ADD COLUMN order_id_new CHAR(36);
UPDATE payment_transactions c JOIN orders p ON c.order_id = p.id SET c.order_id_new = p.new_uuid WHERE c.order_id IS NOT NULL;
ALTER TABLE refunds ADD COLUMN order_id_new CHAR(36);
UPDATE refunds c JOIN orders p ON c.order_id = p.id SET c.order_id_new = p.new_uuid WHERE c.order_id IS NOT NULL;
ALTER TABLE refunds ADD COLUMN created_by_new CHAR(36);
UPDATE refunds c JOIN users p ON c.created_by = p.id SET c.created_by_new = p.new_uuid WHERE c.created_by IS NOT NULL;
ALTER TABLE password_reset_tokens ADD COLUMN user_id_new CHAR(36);
UPDATE password_reset_tokens c JOIN users p ON c.user_id = p.id SET c.user_id_new = p.new_uuid WHERE c.user_id IS NOT NULL;
ALTER TABLE email_verification_tokens ADD COLUMN user_id_new CHAR(36);
UPDATE email_verification_tokens c JOIN users p ON c.user_id = p.id SET c.user_id_new = p.new_uuid WHERE c.user_id IS NOT NULL;
ALTER TABLE user_sessions ADD COLUMN user_id_new CHAR(36);
UPDATE user_sessions c JOIN users p ON c.user_id = p.id SET c.user_id_new = p.new_uuid WHERE c.user_id IS NOT NULL;
ALTER TABLE api_tokens ADD COLUMN user_id_new CHAR(36);
UPDATE api_tokens c JOIN users p ON c.user_id = p.id SET c.user_id_new = p.new_uuid WHERE c.user_id IS NOT NULL;
ALTER TABLE wishlist_items ADD COLUMN user_id_new CHAR(36);
UPDATE wishlist_items c JOIN users p ON c.user_id = p.id SET c.user_id_new = p.new_uuid WHERE c.user_id IS NOT NULL;
ALTER TABLE wishlist_items ADD COLUMN product_id_new CHAR(36);
UPDATE wishlist_items c JOIN products p ON c.product_id = p.id SET c.product_id_new = p.new_uuid WHERE c.product_id IS NOT NULL;
ALTER TABLE reviews ADD COLUMN product_id_new CHAR(36);
UPDATE reviews c JOIN products p ON c.product_id = p.id SET c.product_id_new = p.new_uuid WHERE c.product_id IS NOT NULL;
ALTER TABLE reviews ADD COLUMN user_id_new CHAR(36);
UPDATE reviews c JOIN users p ON c.user_id = p.id SET c.user_id_new = p.new_uuid WHERE c.user_id IS NOT NULL;
ALTER TABLE user_interactions ADD COLUMN user_id_new CHAR(36);
UPDATE user_interactions c JOIN users p ON c.user_id = p.id SET c.user_id_new = p.new_uuid WHERE c.user_id IS NOT NULL;
ALTER TABLE user_interactions ADD COLUMN product_id_new CHAR(36);
UPDATE user_interactions c JOIN products p ON c.product_id = p.id SET c.product_id_new = p.new_uuid WHERE c.product_id IS NOT NULL;
ALTER TABLE chat_conversations ADD COLUMN customer_id_new CHAR(36);
UPDATE chat_conversations c JOIN users p ON c.customer_id = p.id SET c.customer_id_new = p.new_uuid WHERE c.customer_id IS NOT NULL;
ALTER TABLE chat_conversations ADD COLUMN assigned_admin_id_new CHAR(36);
UPDATE chat_conversations c JOIN users p ON c.assigned_admin_id = p.id SET c.assigned_admin_id_new = p.new_uuid WHERE c.assigned_admin_id IS NOT NULL;
ALTER TABLE chat_messages ADD COLUMN sender_id_new CHAR(36);
UPDATE chat_messages c JOIN users p ON c.sender_id = p.id SET c.sender_id_new = p.new_uuid WHERE c.sender_id IS NOT NULL;
ALTER TABLE message_reads ADD COLUMN user_id_new CHAR(36);
UPDATE message_reads c JOIN users p ON c.user_id = p.id SET c.user_id_new = p.new_uuid WHERE c.user_id IS NOT NULL;
ALTER TABLE activity_logs ADD COLUMN user_id_new CHAR(36);
UPDATE activity_logs c JOIN users p ON c.user_id = p.id SET c.user_id_new = p.new_uuid WHERE c.user_id IS NOT NULL;

-- 4. Swap primary keys in parent tables
ALTER TABLE users MODIFY COLUMN id INT NOT NULL;
ALTER TABLE users DROP PRIMARY KEY;
ALTER TABLE users RENAME COLUMN id TO legacy_id;
ALTER TABLE users RENAME COLUMN new_uuid TO id;
ALTER TABLE users ADD PRIMARY KEY (id);

ALTER TABLE products MODIFY COLUMN id INT NOT NULL;
ALTER TABLE products DROP PRIMARY KEY;
ALTER TABLE products RENAME COLUMN id TO legacy_id;
ALTER TABLE products RENAME COLUMN new_uuid TO id;
ALTER TABLE products ADD PRIMARY KEY (id);

ALTER TABLE orders MODIFY COLUMN id INT NOT NULL;
ALTER TABLE orders DROP PRIMARY KEY;
ALTER TABLE orders RENAME COLUMN id TO legacy_id;
ALTER TABLE orders RENAME COLUMN new_uuid TO id;
ALTER TABLE orders ADD PRIMARY KEY (id);

-- 5. Swap foreign keys in child tables

DELIMITER //

CREATE PROCEDURE DropForeignKey(IN tableName VARCHAR(64), IN colName VARCHAR(64))
BEGIN
    DECLARE fkName VARCHAR(64);
    
    SELECT CONSTRAINT_NAME INTO fkName
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = tableName 
      AND COLUMN_NAME = colName 
      AND REFERENCED_TABLE_NAME IS NOT NULL
    LIMIT 1;

    IF fkName IS NOT NULL THEN
        SET @s = CONCAT('ALTER TABLE ', tableName, ' DROP FOREIGN KEY ', fkName);
        PREPARE stmt FROM @s;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //

DELIMITER ;

CALL DropForeignKey('products', 'seller_id');
ALTER TABLE products RENAME COLUMN seller_id TO seller_id_legacy;
ALTER TABLE products RENAME COLUMN seller_id_new TO seller_id;
ALTER TABLE products ADD FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('product_variants', 'product_id');
ALTER TABLE product_variants RENAME COLUMN product_id TO product_id_legacy;
ALTER TABLE product_variants RENAME COLUMN product_id_new TO product_id;
ALTER TABLE product_variants ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
CALL DropForeignKey('orders', 'user_id');
ALTER TABLE orders RENAME COLUMN user_id TO user_id_legacy;
ALTER TABLE orders RENAME COLUMN user_id_new TO user_id;
ALTER TABLE orders ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('order_items', 'order_id');
ALTER TABLE order_items RENAME COLUMN order_id TO order_id_legacy;
ALTER TABLE order_items RENAME COLUMN order_id_new TO order_id;
ALTER TABLE order_items ADD FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
CALL DropForeignKey('order_items', 'product_id');
ALTER TABLE order_items RENAME COLUMN product_id TO product_id_legacy;
ALTER TABLE order_items RENAME COLUMN product_id_new TO product_id;
ALTER TABLE order_items ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
CALL DropForeignKey('inventory_transactions', 'product_id');
ALTER TABLE inventory_transactions RENAME COLUMN product_id TO product_id_legacy;
ALTER TABLE inventory_transactions RENAME COLUMN product_id_new TO product_id;
ALTER TABLE inventory_transactions ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
CALL DropForeignKey('inventory_transactions', 'order_id');
ALTER TABLE inventory_transactions RENAME COLUMN order_id TO order_id_legacy;
ALTER TABLE inventory_transactions RENAME COLUMN order_id_new TO order_id;
ALTER TABLE inventory_transactions ADD FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
CALL DropForeignKey('inventory_transactions', 'created_by');
ALTER TABLE inventory_transactions RENAME COLUMN created_by TO created_by_legacy;
ALTER TABLE inventory_transactions RENAME COLUMN created_by_new TO created_by;
ALTER TABLE inventory_transactions ADD FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('inventory_alerts', 'product_id');
ALTER TABLE inventory_alerts RENAME COLUMN product_id TO product_id_legacy;
ALTER TABLE inventory_alerts RENAME COLUMN product_id_new TO product_id;
ALTER TABLE inventory_alerts ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
CALL DropForeignKey('inventory_alerts', 'resolved_by');
ALTER TABLE inventory_alerts RENAME COLUMN resolved_by TO resolved_by_legacy;
ALTER TABLE inventory_alerts RENAME COLUMN resolved_by_new TO resolved_by;
ALTER TABLE inventory_alerts ADD FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('coupon_usage', 'user_id');
ALTER TABLE coupon_usage RENAME COLUMN user_id TO user_id_legacy;
ALTER TABLE coupon_usage RENAME COLUMN user_id_new TO user_id;
ALTER TABLE coupon_usage ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('coupon_usage', 'order_id');
ALTER TABLE coupon_usage RENAME COLUMN order_id TO order_id_legacy;
ALTER TABLE coupon_usage RENAME COLUMN order_id_new TO order_id;
ALTER TABLE coupon_usage ADD FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
CALL DropForeignKey('shipments', 'order_id');
ALTER TABLE shipments RENAME COLUMN order_id TO order_id_legacy;
ALTER TABLE shipments RENAME COLUMN order_id_new TO order_id;
ALTER TABLE shipments ADD FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
CALL DropForeignKey('shipments', 'created_by');
ALTER TABLE shipments RENAME COLUMN created_by TO created_by_legacy;
ALTER TABLE shipments RENAME COLUMN created_by_new TO created_by;
ALTER TABLE shipments ADD FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('payment_transactions', 'order_id');
ALTER TABLE payment_transactions RENAME COLUMN order_id TO order_id_legacy;
ALTER TABLE payment_transactions RENAME COLUMN order_id_new TO order_id;
ALTER TABLE payment_transactions ADD FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
CALL DropForeignKey('refunds', 'order_id');
ALTER TABLE refunds RENAME COLUMN order_id TO order_id_legacy;
ALTER TABLE refunds RENAME COLUMN order_id_new TO order_id;
ALTER TABLE refunds ADD FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
CALL DropForeignKey('refunds', 'created_by');
ALTER TABLE refunds RENAME COLUMN created_by TO created_by_legacy;
ALTER TABLE refunds RENAME COLUMN created_by_new TO created_by;
ALTER TABLE refunds ADD FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('password_reset_tokens', 'user_id');
ALTER TABLE password_reset_tokens RENAME COLUMN user_id TO user_id_legacy;
ALTER TABLE password_reset_tokens RENAME COLUMN user_id_new TO user_id;
ALTER TABLE password_reset_tokens ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('email_verification_tokens', 'user_id');
ALTER TABLE email_verification_tokens RENAME COLUMN user_id TO user_id_legacy;
ALTER TABLE email_verification_tokens RENAME COLUMN user_id_new TO user_id;
ALTER TABLE email_verification_tokens ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('user_sessions', 'user_id');
ALTER TABLE user_sessions RENAME COLUMN user_id TO user_id_legacy;
ALTER TABLE user_sessions RENAME COLUMN user_id_new TO user_id;
ALTER TABLE user_sessions ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('api_tokens', 'user_id');
ALTER TABLE api_tokens RENAME COLUMN user_id TO user_id_legacy;
ALTER TABLE api_tokens RENAME COLUMN user_id_new TO user_id;
ALTER TABLE api_tokens ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('wishlist_items', 'user_id');
ALTER TABLE wishlist_items RENAME COLUMN user_id TO user_id_legacy;
ALTER TABLE wishlist_items RENAME COLUMN user_id_new TO user_id;
ALTER TABLE wishlist_items ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('wishlist_items', 'product_id');
ALTER TABLE wishlist_items RENAME COLUMN product_id TO product_id_legacy;
ALTER TABLE wishlist_items RENAME COLUMN product_id_new TO product_id;
ALTER TABLE wishlist_items ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
CALL DropForeignKey('reviews', 'product_id');
ALTER TABLE reviews RENAME COLUMN product_id TO product_id_legacy;
ALTER TABLE reviews RENAME COLUMN product_id_new TO product_id;
ALTER TABLE reviews ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
CALL DropForeignKey('reviews', 'user_id');
ALTER TABLE reviews RENAME COLUMN user_id TO user_id_legacy;
ALTER TABLE reviews RENAME COLUMN user_id_new TO user_id;
ALTER TABLE reviews ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('user_interactions', 'user_id');
ALTER TABLE user_interactions RENAME COLUMN user_id TO user_id_legacy;
ALTER TABLE user_interactions RENAME COLUMN user_id_new TO user_id;
ALTER TABLE user_interactions ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('user_interactions', 'product_id');
ALTER TABLE user_interactions RENAME COLUMN product_id TO product_id_legacy;
ALTER TABLE user_interactions RENAME COLUMN product_id_new TO product_id;
ALTER TABLE user_interactions ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
CALL DropForeignKey('chat_conversations', 'customer_id');
ALTER TABLE chat_conversations RENAME COLUMN customer_id TO customer_id_legacy;
ALTER TABLE chat_conversations RENAME COLUMN customer_id_new TO customer_id;
ALTER TABLE chat_conversations ADD FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('chat_conversations', 'assigned_admin_id');
ALTER TABLE chat_conversations RENAME COLUMN assigned_admin_id TO assigned_admin_id_legacy;
ALTER TABLE chat_conversations RENAME COLUMN assigned_admin_id_new TO assigned_admin_id;
ALTER TABLE chat_conversations ADD FOREIGN KEY (assigned_admin_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('chat_messages', 'sender_id');
ALTER TABLE chat_messages RENAME COLUMN sender_id TO sender_id_legacy;
ALTER TABLE chat_messages RENAME COLUMN sender_id_new TO sender_id;
ALTER TABLE chat_messages ADD FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('message_reads', 'user_id');
ALTER TABLE message_reads RENAME COLUMN user_id TO user_id_legacy;
ALTER TABLE message_reads RENAME COLUMN user_id_new TO user_id;
ALTER TABLE message_reads ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CALL DropForeignKey('activity_logs', 'user_id');
ALTER TABLE activity_logs RENAME COLUMN user_id TO user_id_legacy;
ALTER TABLE activity_logs RENAME COLUMN user_id_new TO user_id;
ALTER TABLE activity_logs ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

DROP PROCEDURE DropForeignKey;

SET FOREIGN_KEY_CHECKS = 1;
