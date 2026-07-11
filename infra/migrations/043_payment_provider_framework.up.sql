-- Provider-neutral payment lifecycle. The provider remains disabled until an
-- operator explicitly configures a checkout URL and webhook secret.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS provider_trade_no VARCHAR(128),
  ADD COLUMN IF NOT EXISTS checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS callback_digest VARCHAR(64),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_provider_trade_no
  ON orders(channel, provider_trade_no)
  WHERE provider_trade_no IS NOT NULL;

INSERT INTO system_configs (key, value) VALUES
  ('payment_provider', '"disabled"'),
  ('payment_checkout_url_template', '""'),
  ('payment_webhook_secret', '""'),
  ('payment_order_expire_minutes', '30'),
  ('payment_min_amount', '1'),
  ('payment_max_amount', '50000')
ON CONFLICT (key) DO NOTHING;
