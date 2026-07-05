-- Online payment orders (mock channel)

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  order_no VARCHAR(64) UNIQUE NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  channel VARCHAR(32) NOT NULL DEFAULT 'mock',
  amount NUMERIC(18,2) NOT NULL,
  compute_credited NUMERIC(18,6) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  remark TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_user_time ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);

INSERT INTO system_configs (key, value) VALUES
  ('payment_compute_rate', '100')
ON CONFLICT (key) DO NOTHING;
