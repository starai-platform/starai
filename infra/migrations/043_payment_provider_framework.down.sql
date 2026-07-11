DROP INDEX IF EXISTS idx_orders_provider_trade_no;

ALTER TABLE orders
  DROP COLUMN IF EXISTS provider_trade_no,
  DROP COLUMN IF EXISTS checkout_url,
  DROP COLUMN IF EXISTS callback_digest,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS updated_at;

DELETE FROM system_configs WHERE key IN (
  'payment_provider',
  'payment_checkout_url_template',
  'payment_webhook_secret',
  'payment_order_expire_minutes',
  'payment_min_amount',
  'payment_max_amount'
);
