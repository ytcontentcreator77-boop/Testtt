import { Hono } from "hono";
import { isOwner } from "../env";
import type { AppEnv } from "./app";

export const aiAdmin = new Hono<AppEnv>();
aiAdmin.use("*", async (c, next) => isOwner(c.env, c.get("settings"), c.get("user").id) ? next() : c.json({ error: "FORBIDDEN", code: "FORBIDDEN" }, 403));

const validBase = (value: string) => {
  try { const u = new URL(value); return (u.protocol === "https:" || u.hostname === "localhost" || u.hostname === "127.0.0.1") && !u.username && !u.password; } catch { return false; }
};
const mask = (key: string) => key ? key.slice(0, 4) + "••••" : "";

aiAdmin.get("/ai/providers", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id,name,provider_type,base_url,api_key,models_json,enabled,priority FROM ai_providers ORDER BY priority,id").all<any>();
  return c.json({ items: results.map((p) => ({ ...p, api_key: mask(p.api_key), models: (() => { try { return JSON.parse(p.models_json); } catch { return []; } })() })) });
});
aiAdmin.post("/ai/providers", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b || typeof b.name !== "string" || !b.name.trim() || typeof b.api_key !== "string" || !b.api_key.trim() || typeof b.base_url !== "string" || !validBase(b.base_url)) return c.json({ error: "INVALID_PROVIDER", code: "INVALID_PROVIDER" }, 400);
  const models = Array.isArray(b.models) ? b.models.filter((x: unknown) => typeof x === "string" && x.trim()).slice(0,100) : [];
  if (!models.length) return c.json({ error: "MODELS_REQUIRED", code: "MODELS_REQUIRED" }, 400);
  const r = await c.env.DB.prepare("INSERT INTO ai_providers(name,provider_type,base_url,api_key,models_json,enabled,priority,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?7,?7)")
    .bind(b.name.trim().slice(0,80),String(b.provider_type||"openai-compatible").slice(0,40),b.base_url.replace(/\/+$/,""),b.api_key.trim(),JSON.stringify(models),Number(b.priority)||100,Math.floor(Date.now()/1000)).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});
aiAdmin.put("/ai/providers/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const current = await c.env.DB.prepare("SELECT * FROM ai_providers WHERE id=?1").bind(id).first<any>();
  if (!current) return c.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, 404);
  const b = await c.req.json<any>().catch(() => null);
  if (!b) return c.json({ error: "INVALID_BODY", code: "INVALID_BODY" }, 400);
  const base = b.base_url ?? current.base_url;
  if (!validBase(base)) return c.json({ error: "INVALID_URL", code: "INVALID_URL" }, 400);
  const models = b.models === undefined ? current.models_json : JSON.stringify(Array.isArray(b.models) ? b.models.filter((x: unknown) => typeof x === "string").slice(0,100) : []);
  await c.env.DB.prepare("UPDATE ai_providers SET name=?1,base_url=?2,api_key=?3,models_json=?4,enabled=?5,priority=?6,updated_at=?7 WHERE id=?8")
    .bind(String(b.name ?? current.name).trim().slice(0,80),base.replace(/\/+$/,""),typeof b.api_key === "string" && b.api_key.trim() ? b.api_key.trim() : current.api_key,models,b.enabled === undefined ? current.enabled : +!!b.enabled,Number(b.priority ?? current.priority),Math.floor(Date.now()/1000),id).run();
  return c.json({ ok: true });
});
aiAdmin.delete("/ai/providers/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM ai_providers WHERE id=?1").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});
aiAdmin.get("/ai/plans", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM ai_plans ORDER BY sort,id").all();
  return c.json({ items: results });
});
aiAdmin.put("/ai/plans/:code", async (c) => {
  const code = c.req.param("code");
  const b = await c.req.json<any>().catch(() => null);
  if (!b) return c.json({ error: "INVALID_BODY", code: "INVALID_BODY" }, 400);
  const current = await c.env.DB.prepare("SELECT * FROM ai_plans WHERE code=?1").bind(code).first<any>();
  if (!current) return c.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, 404);
  const price = Number(b.price_cents ?? current.price_cents), daily = Number(b.daily_requests ?? current.daily_requests);
  const context = Number(b.context_messages ?? current.context_messages), output = Number(b.max_output_tokens ?? current.max_output_tokens);
  if (![price,daily,context,output].every(Number.isFinite) || price < 0 || daily < 1 || context < 2 || output < 64) return c.json({ error: "INVALID_LIMITS", code: "INVALID_LIMITS" }, 400);
  await c.env.DB.prepare("UPDATE ai_plans SET name=?1,price_cents=?2,daily_requests=?3,context_messages=?4,max_output_tokens=?5,enabled=?6,sort=?7,updated_at=?8 WHERE code=?9")
    .bind(String(b.name ?? current.name).slice(0,80),Math.round(price),Math.floor(daily),Math.floor(context),Math.floor(output),b.enabled===undefined?current.enabled:+!!b.enabled,Number(b.sort??current.sort),Math.floor(Date.now()/1000),code).run();
  return c.json({ ok: true });
});
aiAdmin.get("/ai/coupons", async (c) => c.json({ items: (await c.env.DB.prepare("SELECT * FROM ai_plan_coupons ORDER BY id DESC").all()).results }));
aiAdmin.post("/ai/coupons", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b || typeof b.code !== "string" || !b.code.trim() || !["percent","fixed"].includes(b.discount_type) || !Number.isFinite(Number(b.discount_value)) || Number(b.discount_value) <= 0) return c.json({ error: "INVALID_COUPON", code: "INVALID_COUPON" }, 400);
  try {
    const r = await c.env.DB.prepare("INSERT INTO ai_plan_coupons(code,discount_type,discount_value,plan_code,max_uses,expires_at,active,created_at) VALUES(?1,?2,?3,?4,?5,?6,1,?7)")
      .bind(b.code.trim().toUpperCase().slice(0,40),b.discount_type,Math.floor(Number(b.discount_value)),b.plan_code||null,b.max_uses?Math.max(1,Math.floor(Number(b.max_uses))):null,b.expires_at?Math.floor(Number(b.expires_at)):null,Math.floor(Date.now()/1000)).run();
    return c.json({ ok: true, id: r.meta.last_row_id });
  } catch { return c.json({ error: "COUPON_EXISTS", code: "COUPON_EXISTS" }, 409); }
});
aiAdmin.delete("/ai/coupons/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM ai_plan_coupons WHERE id=?1").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});
