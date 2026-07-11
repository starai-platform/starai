ALTER TABLE orders
  ALTER COLUMN amount TYPE NUMERIC(18,6),
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_provider_order_id
  ON orders(channel, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

INSERT INTO system_configs (key, value) VALUES
  ('payment_currency', '"USD"'),
  ('payment_product_name', '"StarAI Credits"'),
  ('payment_success_url', '""'),
  ('payment_cancel_url', '""'),
  ('stripe_secret_key', '""'),
  ('stripe_webhook_secret', '""'),
  ('paypal_mode', '"sandbox"'),
  ('paypal_client_id', '""'),
  ('paypal_client_secret', '""'),
  ('paypal_webhook_id', '""'),
  ('paypal_brand_name', '"StarAI"')
ON CONFLICT (key) DO NOTHING;
