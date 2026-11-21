-- AI chat platform tables. Existing key-store plans, coupons, payments and admin data remain untouched.
CREATE TABLE IF NOT EXISTS ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL DEFAULT 'openai-compatible',
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  models_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_providers_enabled ON ai_providers(enabled, priority, id);
CREATE TABLE IF NOT EXISTS ai_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  daily_requests INTEGER NOT NULL DEFAULT 20,
  context_messages INTEGER NOT NULL DEFAULT 12,
  max_output_tokens INTEGER NOT NULL DEFAULT 1200,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO ai_plans(code,name,price_cents,currency,daily_requests,context_messages,max_output_tokens,enabled,sort,updated_at)
VALUES ('free','Free',0,'USD',20,12,1200,1,0,unixepoch());
INSERT OR IGNORE INTO ai_plans(code,name,price_cents,currency,daily_requests,context_messages,max_output_tokens,enabled,sort,updated_at)
VALUES ('pro','Pro',999,'USD',500,40,4000,1,10,unixepoch());
INSERT OR IGNORE INTO ai_plans(code,name,price_cents,currency,daily_requests,context_messages,max_output_tokens,enabled,sort,updated_at)
VALUES ('premium','Premium',1999,'USD',2000,80,8000,1,20,unixepoch());
CREATE TABLE IF NOT EXISTS ai_user_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_user_plans_user ON ai_user_plans(user_id,status,ends_at);
CREATE TABLE IF NOT EXISTS ai_plan_coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  discount_type TEXT NOT NULL CHECK(discount_type IN ('percent','fixed')),
  discount_value INTEGER NOT NULL,
  plan_code TEXT,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_chats (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  model TEXT NOT NULL DEFAULT '',
  provider_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ai_chats_user_updated ON ai_chats(user_id,archived,updated_at DESC);
CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'complete',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES ai_chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_messages_chat ON ai_messages(chat_id,id);
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,day)
) WITHOUT ROWID;
