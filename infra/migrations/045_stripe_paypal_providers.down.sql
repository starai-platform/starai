DROP INDEX IF EXISTS idx_orders_provider_order_id;

ALTER TABLE orders
  DROP COLUMN IF EXISTS provider_order_id,
  DROP COLUMN IF EXISTS currency,
  ALTER COLUMN amount TYPE NUMERIC(18,2) USING ROUND(amount, 2);

DELETE FROM system_configs WHERE key IN (
  'payment_currency',
  'payment_product_name',
  'payment_success_url',
  'payment_cancel_url',
  'stripe_secret_key',
  'stripe_webhook_secret',
  'paypal_mode',
  'paypal_client_id',
  'paypal_client_secret',
  'paypal_webhook_id',
  'paypal_brand_name'
);
