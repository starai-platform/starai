ALTER TABLE payment_packages
  ADD COLUMN IF NOT EXISTS compute_credits NUMERIC(18,6) NULL CHECK (compute_credits IS NULL OR compute_credits > 0);

-- 1 算力约等于 1 元人民币；USD 默认使用平台业务汇率 7.2。
-- 仅修正历史演示默认值 100，不覆盖运营人员已经手工设置的其他倍率。
INSERT INTO system_configs (key, value, updated_at)
VALUES ('payment_compute_rate', '7.2'::jsonb, now())
ON CONFLICT (key) DO UPDATE
SET value='7.2'::jsonb, updated_at=now()
WHERE system_configs.value='100'::jsonb;
