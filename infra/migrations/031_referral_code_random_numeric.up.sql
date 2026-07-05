-- Enforce referral codes as random six-digit numeric codes.
-- Existing valid codes are kept to avoid breaking already shared referral links.

CREATE OR REPLACE FUNCTION starai_random_referral_code()
RETURNS VARCHAR(6)
LANGUAGE plpgsql
AS $$
DECLARE
  candidate VARCHAR(6);
BEGIN
  LOOP
    candidate := (100000 + floor(random() * 900000)::int)::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE referral_code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

DO $$
DECLARE
  row_item RECORD;
  next_code VARCHAR(6);
BEGIN
  FOR row_item IN
    SELECT id
    FROM users
    WHERE referral_code IS NULL
       OR referral_code !~ '^[0-9]{6}$'
  LOOP
    next_code := starai_random_referral_code();
    UPDATE users SET referral_code = next_code WHERE id = row_item.id;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS starai_random_referral_code();

ALTER TABLE users
  ALTER COLUMN referral_code SET NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_referral_code_six_digit_check;

ALTER TABLE users
  ADD CONSTRAINT users_referral_code_six_digit_check
  CHECK (referral_code ~ '^[0-9]{6}$');
