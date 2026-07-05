-- Store reversible encrypted card codes for admin retrieval (hash remains for redemption lookup).
ALTER TABLE recharge_cards ADD COLUMN IF NOT EXISTS code_cipher TEXT;
