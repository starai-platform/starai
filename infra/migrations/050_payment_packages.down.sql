DROP INDEX IF EXISTS idx_orders_payment_package;
ALTER TABLE orders DROP COLUMN IF EXISTS payment_package_id;
DROP TABLE IF EXISTS payment_packages;
