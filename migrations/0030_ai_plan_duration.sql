ALTER TABLE ai_plans ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE ai_star_payments ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 30;
UPDATE ai_plans SET duration_days=0 WHERE code='free';
