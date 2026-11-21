import { Hono } from "hono";
import type { AppEnv } from "./app";

export const ai = new Hono<AppEnv>();

type ProviderRow = { id: number; name: string; base_url: string; api_key: string; models_json: string; enabled: number; priority: number };
type PlanRow = { code: string; name: string; daily_requests: number; context_messages: number; max_output_tokens: number };

const now = () => Math.floor(Date.now() / 1000);
const dayKey = () => new Date().toISOString().slice(0, 10);
const safeTitle = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 64) || "New chat";

async function activePlan(c: any): Promise<PlanRow> {
  const userId = c.get("user").id;
  const sub = await c.env.DB.prepare(
    `SELECT p.code,p.name,p.daily_requests,p.context_messages,p.max_output_tokens
     FROM ai_user_plans s JOIN ai_plans p ON p.code=s.plan_code
     WHERE s.user_id=?1 AND s.status='active' AND (s.ends_at IS NULL OR s.ends_at>?2) AND p.enabled=1
     ORDER BY s.starts_at DESC LIMIT 1`,
  ).bind(userId, now()).first<PlanRow>();
  if (sub) return sub;
  const free = await c.env.DB.prepare("SELECT code,name,daily_requests,context_messages,max_output_tokens FROM ai_plans WHERE code='free' AND enabled=1").first<PlanRow>();
  return free ?? { code: "free", name: "Free", daily_requests: 20, context_messages: 12, max_output_tokens: 1200 };
}

async function usage(c: any, plan: PlanRow) {
  const row = await c.env.DB.prepare("SELECT requests,input_tokens,output_tokens FROM ai_usage WHERE user_id=?1 AND day=?2")
    .bind(c.get("user").id, dayKey()).first<{ requests: number; input_tokens: number; output_tokens: number }>();
  return { plan: { code: plan.code, name: plan.name, dailyRequests: plan.daily_requests, contextMessages: plan.context_messages, maxOutputTokens: plan.max_output_tokens }, requests: row?.requests ?? 0, remaining: Math.max(0, plan.daily_requests - (row?.requests ?? 0)), inputTokens: row?.input_tokens ?? 0, outputTokens: row?.output_tokens ?? 0, day: dayKey() };
}

function modelsOf(p: ProviderRow): string[] {
  try { const x = JSON.parse(p.models_json); return Array.isArray(x) ? x.filter((v) => typeof v === "string").slice(0, 100) : []; } catch { return []; }
}

ai.get("/models", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id,name,models_json FROM ai_providers WHERE enabled=1 ORDER BY priority,id").all<{id:number;name:string;models_json:string}>();
  const models = results.flatMap((p) => {
    let list: string[] = [];
    try { const parsed = JSON.parse(p.models_json); if (Array.isArray(parsed)) list = parsed.filter((x) => typeof x === "string"); } catch {}
    return list.map((model) => ({ providerId: p.id, provider: p.name, model }));
  });
  const plan = await activePlan(c);
  return c.json({ models, usage: await usage(c, plan) });
});

ai.get("/usage", async (c) => c.json(await usage(c, await activePlan(c))));

ai.get("/plans", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT code,name,price_cents,currency,daily_requests,context_messages,max_output_tokens,enabled,sort FROM ai_plans WHERE enabled=1 ORDER BY sort,id").all();
  return c.json({ items: results, current: (await activePlan(c)).code });
});

ai.post("/coupons/validate", async (c) => {
  const body = await c.req.json<{ code?: string; planCode?: string }>().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const planCode = typeof body?.planCode === "string" ? body.planCode : "";
  if (!code || !planCode) return c.json({ error: "INVALID_COUPON", code: "INVALID_COUPON" }, 400);
  const coupon = await c.env.DB.prepare("SELECT * FROM ai_plan_coupons WHERE code=?1 COLLATE NOCASE AND active=1").bind(code).first<any>();
  const plan = await c.env.DB.prepare("SELECT code,price_cents,currency FROM ai_plans WHERE code=?1 AND enabled=1").bind(planCode).first<any>();
  const stamp = now();
  if (!coupon || !plan || (coupon.plan_code && coupon.plan_code !== planCode) || (coupon.starts_at && coupon.starts_at > stamp) || (coupon.expires_at && coupon.expires_at < stamp) || (coupon.max_uses && coupon.used_count >= coupon.max_uses)) return c.json({ error: "COUPON_INVALID_OR_EXPIRED", code: "COUPON_INVALID_OR_EXPIRED" }, 400);
  const discount = coupon.discount_type === "percent" ? Math.floor(plan.price_cents * Math.min(100,coupon.discount_value) / 100) : Math.min(plan.price_cents,coupon.discount_value);
  return c.json({ valid: true, code, planCode, currency: plan.currency, originalCents: plan.price_cents, discountCents: discount, finalCents: Math.max(0,plan.price_cents-discount) });
});

ai.get("/chats", async (c) => {
  const before = Number(c.req.query("before") || Number.MAX_SAFE_INTEGER);
  const { results } = await c.env.DB.prepare(
    "SELECT id,title,model,created_at,updated_at FROM ai_chats WHERE user_id=?1 AND archived=0 AND updated_at<?2 ORDER BY updated_at DESC LIMIT 40",
  ).bind(c.get("user").id, Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER).all();
  return c.json({ items: results });
});

ai.post("/chats", async (c) => {
  const id = crypto.randomUUID();
  const stamp = now();
  await c.env.DB.prepare("INSERT INTO ai_chats(id,user_id,title,created_at,updated_at) VALUES(?1,?2,'New chat',?3,?3)")
    .bind(id, c.get("user").id, stamp).run();
  return c.json({ id, title: "New chat", createdAt: stamp });
});

ai.get("/chats/:id/messages", async (c) => {
  const id = c.req.param("id");
  const chat = await c.env.DB.prepare("SELECT id,title,model,provider_id FROM ai_chats WHERE id=?1 AND user_id=?2").bind(id, c.get("user").id).first();
  if (!chat) return c.json({ error: "CHAT_NOT_FOUND", code: "CHAT_NOT_FOUND" }, 404);
  const { results } = await c.env.DB.prepare("SELECT id,role,content,input_tokens,output_tokens,created_at,status FROM ai_messages WHERE chat_id=?1 AND user_id=?2 ORDER BY id ASC LIMIT 300")
    .bind(id, c.get("user").id).all();
  return c.json({ chat, messages: results });
});

ai.patch("/chats/:id", async (c) => {
  const body = await c.req.json<{ title?: string }>().catch(() => null);
  if (!body || typeof body.title !== "string") return c.json({ error: "INVALID_BODY", code: "INVALID_BODY" }, 400);
  const result = await c.env.DB.prepare("UPDATE ai_chats SET title=?1,updated_at=?2 WHERE id=?3 AND user_id=?4")
    .bind(safeTitle(body.title), now(), c.req.param("id"), c.get("user").id).run();
  if (!result.meta.changes) return c.json({ error: "CHAT_NOT_FOUND", code: "CHAT_NOT_FOUND" }, 404);
  return c.json({ ok: true });
});

ai.delete("/chats/:id", async (c) => {
  const result = await c.env.DB.prepare("DELETE FROM ai_chats WHERE id=?1 AND user_id=?2").bind(c.req.param("id"), c.get("user").id).run();
  if (!result.meta.changes) return c.json({ error: "CHAT_NOT_FOUND", code: "CHAT_NOT_FOUND" }, 404);
  return c.json({ ok: true });
});

ai.post("/chats/:id/messages", async (c) => {
  const body = await c.req.json<{ content?: string; model?: string; providerId?: number }>().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 12000) return c.json({ error: "INVALID_MESSAGE", code: "INVALID_MESSAGE" }, 400);
  const userId = c.get("user").id;
  const chatId = c.req.param("id");
  const chat = await c.env.DB.prepare("SELECT id,title,model,provider_id FROM ai_chats WHERE id=?1 AND user_id=?2").bind(chatId, userId).first<{id:string;title:string;model:string;provider_id:number|null}>();
  if (!chat) return c.json({ error: "CHAT_NOT_FOUND", code: "CHAT_NOT_FOUND" }, 404);
  const plan = await activePlan(c);
  const day = dayKey();
  await c.env.DB.prepare("INSERT OR IGNORE INTO ai_usage(user_id,day) VALUES(?1,?2)").bind(userId, day).run();
  const counter = await c.env.DB.prepare("SELECT requests FROM ai_usage WHERE user_id=?1 AND day=?2").bind(userId, day).first<{requests:number}>();
  if ((counter?.requests ?? 0) >= plan.daily_requests) return c.json({ error: "DAILY_LIMIT_REACHED", code: "DAILY_LIMIT_REACHED", usage: await usage(c, plan) }, 429);

  const providers = (await c.env.DB.prepare("SELECT * FROM ai_providers WHERE enabled=1 ORDER BY priority,id").all<ProviderRow>()).results;
  const requestedModel = typeof body?.model === "string" ? body.model.slice(0, 160) : "";
  const selected = providers.filter((p) => modelsOf(p).includes(requestedModel));
  const candidates = selected.length ? selected : providers;
  const provider = candidates.find((p) => !body?.providerId || p.id === Number(body.providerId)) ?? candidates[0];
  if (!provider) return c.json({ error: "AI_NOT_CONFIGURED", code: "AI_NOT_CONFIGURED" }, 503);
  const model = requestedModel && modelsOf(provider).includes(requestedModel) ? requestedModel : modelsOf(provider)[0];
  if (!model) return c.json({ error: "MODEL_NOT_CONFIGURED", code: "MODEL_NOT_CONFIGURED" }, 503);

  const history = await c.env.DB.prepare("SELECT role,content FROM ai_messages WHERE chat_id=?1 AND user_id=?2 AND status='complete' ORDER BY id DESC LIMIT ?3")
    .bind(chatId, userId, Math.max(2, Math.min(100, plan.context_messages))).all<{role:string;content:string}>();
  const messages = [...history.results.reverse(), { role: "user", content }].filter((m) => m.role === "user" || m.role === "assistant");
  const base = provider.base_url.replace(/\/+$/, "");
  let endpoint: URL;
  try { endpoint = new URL(base + "/chat/completions"); } catch { return c.json({ error: "PROVIDER_URL_INVALID", code: "PROVIDER_URL_INVALID" }, 400); }
  if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost" && endpoint.hostname !== "127.0.0.1") return c.json({ error: "PROVIDER_URL_INVALID", code: "PROVIDER_URL_INVALID" }, 400);
  const userMessage = await c.env.DB.prepare("INSERT INTO ai_messages(chat_id,user_id,role,content,created_at) VALUES(?1,?2,'user',?3,?4)")
    .bind(chatId, userId, content, now()).run();
  try {
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: { authorization: "Bearer " + provider.api_key, "content-type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: plan.max_output_tokens, temperature: 0.7 }),
      signal: AbortSignal.timeout(55000),
    });
    const payload: any = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof payload?.error?.message === "string" ? payload.error.message.slice(0, 240) : "Provider request failed (" + response.status + ")");
    const answer = payload?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) throw new Error("Provider returned an empty response");
    const inputTokens = Number(payload?.usage?.prompt_tokens) || Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);
    const outputTokens = Number(payload?.usage?.completion_tokens) || Math.ceil(answer.length / 4);
    const stamp = now();
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO ai_messages(chat_id,user_id,role,content,input_tokens,output_tokens,created_at) VALUES(?1,?2,'assistant',?3,?4,?5,?6)").bind(chatId,userId,answer,inputTokens,outputTokens,stamp),
      c.env.DB.prepare("UPDATE ai_usage SET requests=requests+1,input_tokens=input_tokens+?1,output_tokens=output_tokens+?2 WHERE user_id=?3 AND day=?4").bind(inputTokens,outputTokens,userId,day),
      c.env.DB.prepare("UPDATE ai_chats SET model=?1,provider_id=?2,updated_at=?3,title=CASE WHEN title='New chat' THEN ?4 ELSE title END WHERE id=?5 AND user_id=?6").bind(model,provider.id,stamp,safeTitle(content.slice(0,56)),chatId,userId),
    ]);
    return c.json({ message: { role: "assistant", content: answer, inputTokens, outputTokens, createdAt: stamp }, usage: await usage(c, plan) });
  } catch (e) {
    await c.env.DB.prepare("UPDATE ai_messages SET status='failed' WHERE id=?1").bind(userMessage.meta.last_row_id).run().catch(() => {});
    return c.json({ error: "AI_PROVIDER_ERROR", code: "AI_PROVIDER_ERROR", message: (e as Error).message.slice(0, 240) }, 502);
  }
});


/** Shared Telegram bot chat path. The bot and Mini App use the same per-user conversation history and daily quota. */
export async function replyToTelegram(env: AppEnv["Bindings"], userId: number, content: string): Promise<string> {
  const stamp = now();
  const day = dayKey();
  const plan = await env.DB.prepare(
    `SELECT p.code,p.daily_requests,p.context_messages,p.max_output_tokens
     FROM ai_user_plans s JOIN ai_plans p ON p.code=s.plan_code
     WHERE s.user_id=?1 AND s.status='active' AND (s.ends_at IS NULL OR s.ends_at>?2) AND p.enabled=1
     ORDER BY s.starts_at DESC LIMIT 1`,
  ).bind(userId, stamp).first<PlanRow>() ?? await env.DB.prepare("SELECT code,daily_requests,context_messages,max_output_tokens FROM ai_plans WHERE code='free' AND enabled=1").first<PlanRow>() ?? {code:"free",daily_requests:20,context_messages:12,max_output_tokens:1200};
  await env.DB.prepare("INSERT OR IGNORE INTO ai_usage(user_id,day) VALUES(?1,?2)").bind(userId,day).run();
  const count = await env.DB.prepare("SELECT requests FROM ai_usage WHERE user_id=?1 AND day=?2").bind(userId,day).first<{requests:number}>();
  if ((count?.requests ?? 0) >= plan.daily_requests) return "You have reached your daily AI message limit. Open the Mini App and check your Plans page to see available upgrades.";
  let chat = await env.DB.prepare("SELECT id,model FROM ai_chats WHERE user_id=?1 AND archived=0 AND updated_at>?2 ORDER BY updated_at DESC LIMIT 1")
    .bind(userId,stamp-86400).first<{id:string;model:string}>();
  if (!chat) {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO ai_chats(id,user_id,title,created_at,updated_at) VALUES(?1,?2,'Telegram chat',?3,?3)").bind(id,userId,stamp).run();
    chat = {id,model:""};
  }
  const providers = (await env.DB.prepare("SELECT * FROM ai_providers WHERE enabled=1 ORDER BY priority,id").all<ProviderRow>()).results;
  if (!providers.length) return "The AI assistant is not configured yet. Please ask the administrator to add an AI provider.";
  const provider = providers.find((p)=>modelsOf(p).includes(chat!.model)) ?? providers.find((p)=>modelsOf(p).length>0);
  if (!provider) return "No enabled AI model is available right now. Please contact the administrator.";
  const model = modelsOf(provider).includes(chat.model) ? chat.model : modelsOf(provider)[0];
  const previous = await env.DB.prepare("SELECT role,content FROM ai_messages WHERE chat_id=?1 AND user_id=?2 AND status='complete' ORDER BY id DESC LIMIT ?3")
    .bind(chat.id,userId,Math.max(2,Math.min(100,plan.context_messages))).all<{role:string;content:string}>();
  const messages = [...previous.results.reverse(),{role:"user",content:content.slice(0,12000)}].filter((m)=>m.role==="user"||m.role==="assistant");
  await env.DB.prepare("INSERT INTO ai_messages(chat_id,user_id,role,content,created_at) VALUES(?1,?2,'user',?3,?4)").bind(chat.id,userId,content.slice(0,12000),stamp).run();
  try {
    const endpoint = new URL(provider.base_url.replace(/\/+$/,"")+"/chat/completions");
    const response = await fetch(endpoint.toString(),{method:"POST",headers:{authorization:"Bearer "+provider.api_key,"content-type":"application/json"},body:JSON.stringify({model,messages,max_tokens:plan.max_output_tokens,temperature:0.7}),signal:AbortSignal.timeout(55000)});
    const payload:any=await response.json().catch(()=>null);
    if(!response.ok)throw new Error("Provider returned "+response.status);
    const answer=payload?.choices?.[0]?.message?.content;
    if(typeof answer!=="string"||!answer.trim())throw new Error("Empty AI response");
    const inputTokens=Number(payload?.usage?.prompt_tokens)||Math.ceil(messages.reduce((n,m)=>n+m.content.length,0)/4);
    const outputTokens=Number(payload?.usage?.completion_tokens)||Math.ceil(answer.length/4);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ai_messages(chat_id,user_id,role,content,input_tokens,output_tokens,created_at) VALUES(?1,?2,'assistant',?3,?4,?5,?6)").bind(chat.id,userId,answer,inputTokens,outputTokens,now()),
      env.DB.prepare("UPDATE ai_usage SET requests=requests+1,input_tokens=input_tokens+?1,output_tokens=output_tokens+?2 WHERE user_id=?3 AND day=?4").bind(inputTokens,outputTokens,userId,day),
      env.DB.prepare("UPDATE ai_chats SET model=?1,provider_id=?2,updated_at=?3,title=CASE WHEN title IN ('New chat','Telegram chat') THEN ?4 ELSE title END WHERE id=?5").bind(model,provider.id,now(),safeTitle(content.slice(0,56)),chat.id),
    ]);
    return answer.length>3900?answer.slice(0,3890)+"\n\n[Message shortened. Open the Mini App to read the full reply.]":answer;
  } catch(e) {
    return "Sorry, the AI provider is temporarily unavailable. Please try again in a moment.";
  }
}
