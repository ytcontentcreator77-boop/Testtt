import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { navigate } from "../router";
import { BackNav } from "../ui";

type Provider = { id:number; name:string; base_url:string; api_key:string; models:string[]; enabled:number; priority:number };
type Plan = { code:string; name:string; price_cents:number; daily_requests:number; context_messages:number; max_output_tokens:number; enabled:number; sort:number };
type Coupon = { id:number; code:string; discount_type:string; discount_value:number; plan_code:string|null; max_uses:number|null; used_count:number; expires_at:number|null; active:number };

const field = (label:string,value:string,onInput:(v:string)=>void,placeholder="") => <label class="ai-admin-field">{label}<input value={value} placeholder={placeholder} onInput={(e)=>onInput((e.currentTarget as HTMLInputElement).value)}/></label>;

export function AdminAiManagement() {
  const [providers,setProviders]=useState<Provider[]>([]);
  const [plans,setPlans]=useState<Plan[]>([]);
  const [coupons,setCoupons]=useState<Coupon[]>([]);
  const [name,setName]=useState("OpenAI");
  const [base,setBase]=useState("https://api.openai.com/v1");
  const [key,setKey]=useState("");
  const [models,setModels]=useState("gpt-4o-mini");
  const [couponCode,setCouponCode]=useState("");
  const [couponStart,setCouponStart]=useState("");
  const [couponExpiry,setCouponExpiry]=useState("");
  const [discountType,setDiscountType]=useState("percent");
  const [discountValue,setDiscountValue]=useState("10");
  const [couponPlan,setCouponPlan]=useState("");
  const [maxUses,setMaxUses]=useState("");
  const [assignUser,setAssignUser]=useState("");
  const [assignPlan,setAssignPlan]=useState("pro");
  const [assignDays,setAssignDays]=useState("30");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  const load=()=>Promise.all([
    api<{items:Provider[]}>("/admin/ai/providers"),
    api<{items:Plan[]}>("/admin/ai/plans"),
    api<{items:Coupon[]}>("/admin/ai/coupons"),
  ]).then(([p,l,c])=>{setProviders(p.items??[]);setPlans(l.items??[]);setCoupons(c.items??[])}).catch((e)=>setError(e?.code||"Could not load AI admin data"));
  useEffect(()=>{void load()},[]);
  const addProvider=async()=>{
    if(!name.trim()||!key.trim()||!models.trim())return;
    setBusy(true);setError("");
    try{await api("/admin/ai/providers",{method:"POST",body:{name,base_url:base,api_key:key,models:models.split(/[\n,]/).map(x=>x.trim()).filter(Boolean)}});setKey("");await load();}
    catch(e:any){setError(e?.code||"Provider could not be saved")}finally{setBusy(false)}
  };
  const savePlan=async(p:Plan)=>{
    try{await api("/admin/ai/plans/"+encodeURIComponent(p.code),{method:"PUT",body:{name:p.name,price_cents:p.price_cents,daily_requests:p.daily_requests,context_messages:p.context_messages,max_output_tokens:p.max_output_tokens,enabled:!!p.enabled,sort:p.sort}});await load();}
    catch(e:any){setError(e?.code||"Plan save failed")}
  };
  const addCoupon=async()=>{
    if(!couponCode.trim()||Number(discountValue)<=0)return;
    try{await api("/admin/ai/coupons",{method:"POST",body:{code:couponCode,discount_type:discountType,discount_value:Number(discountValue),plan_code:couponPlan||null,max_uses:maxUses?Number(maxUses):null,starts_at:couponStart?Math.floor(new Date(couponStart).getTime()/1000):null,expires_at:couponExpiry?Math.floor(new Date(couponExpiry).getTime()/1000):null}});setCouponCode("");setCouponStart("");setCouponExpiry("");await load();}
    catch(e:any){setError(e?.code||"Coupon could not be created")}
  };
  const testProvider=async(id:number)=>{try{const r=await api<any>("/admin/ai/providers/"+id+"/test",{method:"POST",body:{}});alert(r.ok?"Provider connected · "+r.model:"Provider test failed");}catch(e:any){setError(e?.error||e?.code||"Provider test failed")}};
  const toggleProvider=async(p:Provider)=>{
    try{await api("/admin/ai/providers/"+p.id,{method:"PUT",body:{enabled:!p.enabled}});await load();}
    catch(e:any){setError(e?.code||"Provider update failed")}
  };
  const deleteProvider=async(id:number)=>{
    if(!confirm("Delete this AI provider?"))return;
    try{await api("/admin/ai/providers/"+id,{method:"DELETE"});await load()}catch(e:any){setError(e?.code||"Delete failed")}
  };
  const assign=async()=>{
    const id=Number(assignUser);if(!Number.isSafeInteger(id)||id<=0)return;
    try{await api("/admin/ai/users/"+id+"/plan",{method:"POST",body:{planCode:assignPlan,days:Number(assignDays)||30}});setError("");alert("AI plan assigned successfully.");}
    catch(e:any){setError(e?.code||"Plan assignment failed")}
  };
  const deleteCoupon=async(id:number)=>{
    if(!confirm("Delete this AI plan coupon?"))return;
    try{await api("/admin/ai/coupons/"+id,{method:"DELETE"});await load()}catch(e:any){setError(e?.code||"Delete failed")}
  };

  return <main class="ai-page">
    <BackNav to="/admin"/>
    <header class="ai-page-head"><span>AI CONTROL CENTER</span><h1>AI platform settings</h1><p>Manage model providers, private API credentials, plan quotas and plan discounts. Existing store settings remain available in the Admin menu.</p></header>
    {error?<div class="ai-error">{error}<button onClick={()=>setError("")}>Dismiss</button></div>:null}
    <section class="ai-admin-section"><h2>AI providers & API keys</h2><p class="ai-muted">Keys are saved server-side and only masked values are returned to the Mini App.</p>
      <div class="ai-admin-card ai-admin-grid">
        {field("Provider name",name,setName,"OpenAI / Gemini / Anthropic")}
        {field("OpenAI-compatible API base URL",base,setBase,"https://api.openai.com/v1")}
        {field("Secret API key",key,setKey,"Paste API key (kept private)")}
        {field("Models (comma or newline separated)",models,setModels,"gpt-4o-mini, gpt-4.1")}
        <button class="ai-admin-save" disabled={busy||!key.trim()} onClick={()=>void addProvider()}>{busy?"Saving…":"＋ Add provider"}</button>
      </div>
      {providers.map(p=><article class="ai-admin-card"><h3>{p.name} <small>#{p.id}</small></h3><p>{p.base_url}</p><p>Key: {p.api_key} · Models: {(p.models??[]).join(", ")}</p><button onClick={()=>void testProvider(p.id)}>Test connection</button><button onClick={()=>void toggleProvider(p)}>{p.enabled?"Disable":"Enable"}</button><button class="danger" onClick={()=>void deleteProvider(p.id)}>Delete</button></article>)}
      {!providers.length?<p class="ai-muted">No AI provider configured. Add at least one provider to enable chat replies.</p>:null}
    </section>
    <section class="ai-admin-section"><h2>AI plans & usage limits</h2><p class="ai-muted">Set monthly USD prices, daily message quotas and context/output limits.</p>
      {plans.map(p=><article class="ai-admin-card ai-admin-grid">
        <h3>{p.name} · {p.code}</h3>
        {field("Plan name",p.name,(v)=>setPlans(xs=>xs.map(x=>x.code===p.code?{...x,name:v}:x)))}
        {field("Monthly price (USD cents)",String(p.price_cents),(v)=>setPlans(xs=>xs.map(x=>x.code===p.code?{...x,price_cents:Number(v)||0}:x)))}
        {field("Messages per day",String(p.daily_requests),(v)=>setPlans(xs=>xs.map(x=>x.code===p.code?{...x,daily_requests:Number(v)||1}:x)))}
        {field("Context messages",String(p.context_messages),(v)=>setPlans(xs=>xs.map(x=>x.code===p.code?{...x,context_messages:Number(v)||2}:x)))}
        {field("Maximum output tokens",String(p.max_output_tokens),(v)=>setPlans(xs=>xs.map(x=>x.code===p.code?{...x,max_output_tokens:Number(v)||64}:x)))}
        <button class="ai-admin-save" onClick={()=>void savePlan(p)}>Save {p.name}</button>
      </article>)}
    </section>
    <section class="ai-admin-section"><h2>Assign a plan to a user</h2>
      <div class="ai-admin-card ai-admin-grid">
        {field("Telegram user ID",assignUser,setAssignUser,"123456789")}
        <label class="ai-admin-field">Plan<select value={assignPlan} onChange={e=>setAssignPlan((e.currentTarget as HTMLSelectElement).value)}>{plans.map(p=><option value={p.code}>{p.name}</option>)}</select></label>
        {field("Duration in days",assignDays,setAssignDays,"30")}
        <button class="ai-admin-save" onClick={()=>void assign()}>Assign plan</button>
      </div>
    </section>
    <section class="ai-admin-section"><h2>Plan coupons & discounts</h2>
      <div class="ai-admin-card ai-admin-grid">
        {field("Coupon code",couponCode,setCouponCode,"WELCOME20")}
        <label class="ai-admin-field">Discount type<select value={discountType} onChange={e=>setDiscountType((e.currentTarget as HTMLSelectElement).value)}><option value="percent">Percentage (%)</option><option value="fixed">Fixed USD cents</option></select></label>
        {field(discountType==="percent"?"Discount percent":"Discount amount (USD cents)",discountValue,setDiscountValue,"10")}
        <label class="ai-admin-field">Apply to plan<select value={couponPlan} onChange={e=>setCouponPlan((e.currentTarget as HTMLSelectElement).value)}><option value="">All plans</option>{plans.map(p=><option value={p.code}>{p.name}</option>)}</select></label>
        {field("Maximum redemptions (blank = unlimited)",maxUses,setMaxUses,"100")}
        <label class="ai-admin-field">Starts at (optional)<input type="datetime-local" value={couponStart} onInput={e=>setCouponStart((e.currentTarget as HTMLInputElement).value)}/></label>
        <label class="ai-admin-field">Expires at (optional)<input type="datetime-local" value={couponExpiry} onInput={e=>setCouponExpiry((e.currentTarget as HTMLInputElement).value)}/></label>
        <button class="ai-admin-save" onClick={()=>void addCoupon()}>＋ Create coupon</button>
      </div>
      {coupons.map(c=><article class="ai-admin-card"><h3>{c.code}</h3><p>{c.discount_type==="percent"?c.discount_value+"% off":"$"+(c.discount_value/100).toFixed(2)+" off"} · {c.plan_code||"All plans"} · Used {c.used_count}{c.max_uses?"/"+c.max_uses:""}{c.expires_at?" · Expires "+new Date(c.expires_at*1000).toLocaleDateString():""}</p><button class="danger" onClick={()=>void deleteCoupon(c.id)}>Delete coupon</button></article>)}
    </section>
    <button class="ai-admin-save" onClick={()=>navigate("/admin")}>Back to full admin panel</button>
  </main>;
}
