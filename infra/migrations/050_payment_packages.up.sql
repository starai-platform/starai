CREATE TABLE IF NOT EXISTS payment_packages (
  id BIGSERIAL PRIMARY KEY,
  public_id VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL DEFAULT '',
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  badge VARCHAR(64) NOT NULL DEFAULT '',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(amount)
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_package_id BIGINT REFERENCES payment_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_packages_enabled_sort
  ON payment_packages(is_enabled, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_package
  ON orders(payment_package_id);

INSERT INTO payment_packages (public_id, name, amount, sort_order) VALUES
  ('pay_10',  '10 USD',  10.00, 10),
  ('pay_30',  '30 USD',  30.00, 20),
  ('pay_50',  '50 USD',  50.00, 30),
  ('pay_100', '100 USD', 100.00, 40),
  ('pay_200', '200 USD', 200.00, 50)
ON CONFLICT (amount) DO NOTHING;
