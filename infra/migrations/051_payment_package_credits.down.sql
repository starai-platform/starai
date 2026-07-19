ALTER TABLE payment_packages DROP COLUMN IF EXISTS compute_credits;
UPDATE system_configs SET value='100'::jsonb, updated_at=now()
WHERE key='payment_compute_rate' AND value='7.2'::jsonb;
