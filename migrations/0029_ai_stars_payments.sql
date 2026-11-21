CREATE TABLE IF NOT EXISTS ai_star_payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 plan_code TEXT NOT NULL,
 stars INTEGER NOT NULL,
 coupon_code TEXT,
 discount_cents INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending',
 charge_id TEXT,
 created_at INTEGER NOT NULL,
 paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS ai_star_payments_user ON ai_star_payments(user_id,status);
