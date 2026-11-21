CREATE TABLE IF NOT EXISTS ai_coupon_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  plan_code TEXT NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  redeemed_at INTEGER NOT NULL,
  UNIQUE(coupon_id,user_id),
  FOREIGN KEY(coupon_id) REFERENCES ai_plan_coupons(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_coupon_redemptions_user ON ai_coupon_redemptions(user_id,redeemed_at DESC);
