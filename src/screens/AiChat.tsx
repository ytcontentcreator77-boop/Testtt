import { useEffect, useMemo, useState } from "preact/hooks";
import { api } from "../api";
import { Icon } from "../icons";
import { navigate, useRoute } from "../router";
import { BackNav } from "../ui";
import { openTelegramLink, openInvoice } from "../tg";
import "./AiChat.css";

type Model = { providerId: number; provider: string; model: string };
type Chat = { id: string; title: string; model: string; updated_at: number };
type Message = { id: number; role: "user" | "assistant"; content: string; created_at: number; status?: string };
type Usage = { plan: { code: string; name: string; dailyRequests: number }; requests: number; remaining: number };

function ChatList({ items, onPick, onNew }: { items: Chat[]; onPick: (id: string) => void; onNew: () => void }) {
  return <div class="ai-history-list">
    <button class="ai-new-chat" onClick={onNew}><Icon name="plus" size={17}/> New conversation</button>
    {items.length ? items.map((chat) => <button class="ai-history-item" key={chat.id} onClick={() => onPick(chat.id)}>
      <span class="ai-history-icon"><Icon name="chat" size={17}/></span>
      <span class="ai-history-copy"><b>{chat.title || "New chat"}</b><small>{chat.model || "AI conversation"} · {new Date(chat.updated_at*1000).toLocaleDateString()}</small></span>
    </button>) : <p class="ai-muted">Your saved conversations will appear here.</p>}
  </div>;
}

export function AiChat() {
  const route = useRoute();
  const routeId = route.parts[1] || "";
  const [models, setModels] = useState<Model[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState(routeId);
  const [modelKey, setModelKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [error, setError] = useState("");

  const selectedModel = useMemo(() => models.find((m) => `${m.providerId}:${m.model}` === modelKey) ?? models[0], [models, modelKey]);

  useEffect(() => { setSelectedId(routeId); }, [routeId]);
  useEffect(() => {
    Promise.all([api<any>("/ai/models"), api<{items:Chat[]}>("/ai/chats")]).then(([m,c]) => {
      setModels(m.models ?? []);
      setUsage(m.usage ?? null);
      setChats(c.items ?? []);
      if (m.models?.length) setModelKey(`${m.models[0].providerId}:${m.models[0].model}`);
    }).catch((e) => setError(e?.code || "Unable to load AI settings"));
  }, []);
  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    let live = true;
    api<{messages:Message[]}>("/ai/chats/" + encodeURIComponent(selectedId) + "/messages")
      .then((r) => live && setMessages(r.messages ?? []))
      .catch((e) => live && setError(e?.code || "Unable to load conversation"));
    return () => { live = false; };
  }, [selectedId]);

  const createChat = async () => {
    const r = await api<{id:string}>("/ai/chats", { method:"POST", body:{} });
    setChats((list) => [{ id:r.id,title:"New chat",model:"",updated_at:Math.floor(Date.now()/1000) },...list]);
    setSelectedId(r.id);
    setMessages([]);
    setHistoryOpen(false);
    return r.id;
  };

  const send = async () => {
    const content = prompt.trim();
    if (!content || busy) return;
    if (!models.length) { setError("No AI provider is configured yet. Ask the administrator to add an API provider."); return; }
    setBusy(true); setError(""); setPrompt("");
    try {
      const isNew = !selectedId;
      const id = selectedId || await createChat();
      await api("/ai/chats/" + encodeURIComponent(id) + "/messages", {
        method:"POST",
        body:{ content, model:selectedModel?.model, providerId:selectedModel?.providerId },
      });
      const [history, chatList, currentUsage] = await Promise.all([
        api<{messages:Message[]}>("/ai/chats/" + encodeURIComponent(id) + "/messages"),
        api<{items:Chat[]}>("/ai/chats"),
        api<Usage>("/ai/usage"),
      ]);
      setMessages(history.messages ?? []);
      setChats(chatList.items ?? []);
      setUsage(currentUsage);
      if (isNew) navigate("/chat/" + encodeURIComponent(id));
    } catch (e:any) {
      setPrompt(content);
      setError(e?.code === "DAILY_LIMIT_REACHED" ? "You have reached today's message limit. Upgrade your plan or try again tomorrow." : e?.message || e?.code || "The AI request failed.");
    } finally { setBusy(false); }
  };

  const chooseChat = (id:string) => { setSelectedId(id); navigate("/chat/" + encodeURIComponent(id)); setHistoryOpen(false); };
  const removeChat = async () => {
    if (!selectedId || !confirm("Delete this conversation and its messages?")) return;
    try { await api("/ai/chats/" + encodeURIComponent(selectedId), {method:"DELETE"}); setChats((x)=>x.filter((c)=>c.id!==selectedId)); setSelectedId(""); setMessages([]); navigate("/"); }
    catch(e:any){setError(e?.code||"Could not delete conversation");}
  };

  return <main class="ai-shell">
    <header class="ai-topbar">
      <div class="ai-brand"><span class="ai-brand-mark"><Icon name="spark" size={19}/></span><span><b>AI Assistant</b><small>Private conversations</small></span></div>
      <div class="ai-top-actions">
        <button class="ai-icon-button" aria-label="Conversation history" onClick={()=>setHistoryOpen(!historyOpen)}><Icon name="clock" size={19}/></button>
        <button class="ai-icon-button" aria-label="New chat" onClick={()=>{setSelectedId("");setMessages([]);navigate("/");}}><Icon name="plus" size={19}/></button>
      </div>
    </header>
    {historyOpen ? <section class="ai-history-panel"><ChatList items={chats} onPick={chooseChat} onNew={()=>{setSelectedId("");setMessages([]);navigate("/");setHistoryOpen(false);}}/></section> : null}
    <section class="ai-chat-meta">
      <label class="ai-model-label">MODEL
        <select value={modelKey} onChange={(e)=>setModelKey((e.currentTarget as HTMLSelectElement).value)}>
          {models.map((m)=><option value={`${m.providerId}:${m.model}`}>{m.provider} · {m.model}</option>)}
        </select>
      </label>
      <span class="ai-plan-pill">{usage?.plan?.name ?? "Free"} · {usage ? `${usage.remaining} left today` : "Loading limits"}</span>
    </section>
    <section class="ai-messages" aria-live="polite">
      {messages.length ? messages.map((m)=><article class={m.role==="user"?"ai-message user":"ai-message assistant"} key={m.id}>
        <span class="ai-avatar">{m.role==="user"?"You":"AI"}</span><div class="ai-bubble"><div class="ai-message-text">{m.content}</div><small>{new Date(m.created_at*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small></div>
      </article>) : <div class="ai-empty">
        <div class="ai-empty-symbol"><Icon name="spark" size={28}/></div>
        <h1>What can I help you with?</h1>
        <p>Ask questions, write code, brainstorm ideas, summarize documents and more.</p>
        <div class="ai-suggestions">
          {["Explain a difficult topic simply","Help me build a website","Write and debug some code"].map((s)=><button onClick={()=>setPrompt(s)}>{s}<Icon name="out" size={15}/></button>)}
        </div>
      </div>}
      {busy ? <div class="ai-message assistant"><span class="ai-avatar">AI</span><div class="ai-bubble ai-thinking"><i/><i/><i/></div></div> : null}
      {error ? <div class="ai-error">{error}<button onClick={()=>setError("")}>Dismiss</button></div> : null}
    </section>
    <footer class="ai-composer-wrap">
      {selectedId ? <div class="ai-chat-actions"><button onClick={()=>{const c=chats.find(x=>x.id===selectedId);const name=window.prompt("Rename conversation",c?.title||"New chat");if(name?.trim())api("/ai/chats/"+encodeURIComponent(selectedId),{method:"PATCH",body:{title:name}}).then(()=>api<{items:Chat[]}>("/ai/chats").then(r=>setChats(r.items))).catch(()=>setError("Rename failed"));}}>Rename</button><button onClick={removeChat}>Delete chat</button></div> : null}
      <div class="ai-composer">
        <textarea value={prompt} rows={1} placeholder="Message AI…" onInput={(e)=>setPrompt((e.currentTarget as HTMLTextAreaElement).value)} onKeyDown={(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}}/>
        <button class="ai-send" disabled={busy||!prompt.trim()||!models.length} onClick={()=>void send()} aria-label="Send message"><Icon name="plus" size={19}/></button>
      </div>
      <div class="ai-footnote">AI can make mistakes. Check important information. · <a href="#/plans">View plans</a></div>
    </footer>
  </main>;
}

export function AiHistory() {
  const [items,setItems]=useState<Chat[]>([]);
  const [q,setQ]=useState("");
  const [loading,setLoading]=useState(true);
  useEffect(()=>{api<{items:Chat[]}>("/ai/chats").then(r=>setItems(r.items??[])).catch(()=>{}).finally(()=>setLoading(false));},[]);
  const filtered=items.filter(x=>x.title.toLowerCase().includes(q.toLowerCase()));
  return <main class="ai-page"><BackNav to="/"/><header class="ai-page-head"><span>YOUR WORKSPACE</span><h1>Conversation history</h1><p>Pick up where you left off. Your chats are saved to your account.</p></header>
    <input class="ai-search" value={q} onInput={(e)=>setQ((e.currentTarget as HTMLInputElement).value)} placeholder="Search conversations"/>
    <ChatList items={filtered} onPick={(id)=>navigate("/chat/"+encodeURIComponent(id))} onNew={()=>navigate("/")}/>
    {!loading&&!filtered.length?<p class="ai-muted">No conversations found.</p>:null}
  </main>;
}

export function AiPlans() {
  const [plans,setPlans]=useState<any[]>([]);
  const [current,setCurrent]=useState("free");
  const [wallet,setWallet]=useState(0);
  const [supportUsername,setSupportUsername]=useState("");
  const [code,setCode]=useState("");
  const [coupon,setCoupon]=useState<any>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState("");
  const [result,setResult]=useState("");
  useEffect(()=>{Promise.all([api<any>("/ai/plans"),api<any>("/me")]).then(([r,me])=>{setPlans(r.items??[]);setCurrent(r.current??"free");setWallet(Number(r.walletBalanceInr??0));setSupportUsername(String(me.supportUsername??"").replace(/^@/,""))}).catch(e=>setError(e?.code||"Unable to load plans"));},[]);
  const validate=async(planCode:string)=>{if(!code.trim())return;try{const r=await api<any>("/ai/coupons/validate",{method:"POST",body:{code,planCode}});setCoupon(r);setError("")}catch(e:any){setCoupon(null);setError(e?.code||"Coupon is not valid")}};

  const buyWithStars=async(planCode:string)=>{
    if(busy)return;setBusy(planCode);setError("");setResult("");
    try{
      const invoice=await api<any>("/ai/plans/"+encodeURIComponent(planCode)+"/stars-invoice",{method:"POST",body:{couponCode:coupon?.planCode===planCode?code:""}});
      const status=await openInvoice(invoice.url);
      if(status==="paid"){const fresh=await api<any>("/ai/plans");setCurrent(fresh.current??planCode);setWallet(Number(fresh.walletBalanceInr??wallet));setCoupon(null);setCode("");setResult("Payment successful. Your "+planCode.toUpperCase()+" plan is active for 30 days.");}
      else if(status==="failed")setError("Stars payment failed. Please try again.");
      else if(status==="pending")setResult("Payment is pending. Your plan will activate after Telegram confirms payment.");
    }catch(e:any){setError(e?.code||"Unable to create Stars invoice");}
    finally{setBusy("")}
  };
  const buy=async(planCode:string)=>{
    if(planCode.toLowerCase()==="pro"){
      if(!supportUsername){setError("Admin support is not configured. Please contact the bot administrator.");return;}
      const message=`Hello, I want to purchase the Pro AI plan.${coupon?.planCode===planCode && code.trim()?` Coupon: ${code.trim()}.`:""} Please help me activate it.`;
      openTelegramLink(`https://t.me/${supportUsername}?text=${encodeURIComponent(message)}`);
      setResult("Your Pro plan request is ready in the admin chat. Send the message to complete your purchase.");
      return;
    }
    if(busy)return;setBusy(planCode);setError("");setResult("");
    try{const r=await api<any>("/ai/plans/"+encodeURIComponent(planCode)+"/purchase",{method:"POST",body:{couponCode:coupon?.planCode===planCode?code:""}});setWallet(Number(r.balanceInr??wallet));setCurrent(planCode);setCoupon(null);setResult("Plan activated successfully. Charged ₹"+Number(r.chargedInr??0).toFixed(2)+".");setCode("");}
    catch(e:any){setError(e?.code==="INSUFFICIENT_WALLET_BALANCE"?"Insufficient wallet balance. Add funds, then try again.":e?.code||"Plan purchase failed");}
    finally{setBusy("")}
  };
  return <main class="ai-page"><BackNav to="/"/><header class="ai-page-head"><span>MEMBERSHIP</span><h1>Choose your AI plan</h1><p>More daily messages, longer context and larger responses. Plans renew for 30 days when activated.</p></header>
    <div class="ai-wallet-balance"><span>WALLET BALANCE</span><b>₹{wallet.toFixed(2)}</b><a href="#/funds">Add funds</a></div>
    <div class="ai-coupon-entry"><input value={code} onInput={(e)=>{setCode((e.currentTarget as HTMLInputElement).value.toUpperCase());setCoupon(null)}} placeholder="Have a plan coupon?"/><span>Apply it on the plan you want to activate.</span></div>

    <section class="ai-plan-compare"><h2>Free vs Pro</h2><p>Compare what you get before upgrading.</p><div class="ai-compare-grid">
      <article><b>FREE</b><strong>{plans.find(x=>x.code==="free")?.daily_requests??20} messages/day</strong><span>{plans.find(x=>x.code==="free")?.context_messages??12} chat context</span><span>{(plans.find(x=>x.code==="free")?.max_output_tokens??1200).toLocaleString()} max output tokens</span><span>Standard access</span></article>
      <article class="featured"><b>PRO</b><strong>{plans.find(x=>x.code==="pro")?.daily_requests??500} messages/day</strong><span>{plans.find(x=>x.code==="pro")?.context_messages??40} chat context</span><span>{(plans.find(x=>x.code==="pro")?.max_output_tokens??4000).toLocaleString()} max output tokens</span><span>Priority AI access · 30 days</span></article>
    </div></section>
    {plans.map((p)=><article class="ai-plan-card"><div class="ai-plan-head"><div><span>{p.code.toUpperCase()}</span><h2>{p.name}</h2></div><strong>{p.price_cents===0?"Free":`$${(p.price_cents/100).toFixed(2)}`}<small>/ 30 days</small></strong></div>
      <ul><li>{p.daily_requests.toLocaleString()} messages per day</li><li>{p.context_messages} messages of conversation context</li><li>Up to {p.max_output_tokens.toLocaleString()} output tokens</li></ul>
      <div class="ai-plan-inr">Wallet price: ₹{Number(coupon?.planCode===p.code && p.price_cents ? p.priceInr*coupon.finalCents/p.price_cents : p.priceInr??0).toFixed(2)}</div>
      {coupon?.planCode===p.code?<div class="ai-discount">Coupon applied · Save ${(coupon.discountCents/100).toFixed(2)} · New price ${(coupon.finalCents/100).toFixed(2)}</div>:null}
      <div class="ai-plan-actions"><button class="ai-plan-coupon" onClick={()=>validate(p.code)} disabled={!code.trim()}>Apply coupon</button>{p.price_cents>0?<><button class="ai-plan-buy" onClick={()=>void buyWithStars(p.code)} disabled={!!busy}>{busy===p.code?"Opening…":"Buy with ⭐ Stars"}</button>{p.code.toLowerCase()==="pro"?<button class="ai-plan-contact" onClick={()=>void buy(p.code)}>Contact admin</button>:null}</>:<button class="ai-plan-buy" onClick={()=>void buy(p.code)} disabled={!!busy}>Activate free plan</button>}</div>
      {current===p.code?<small class="ai-current-plan">Current plan</small>:null}
    </article>)}
    {result?<p class="ai-success">{result}</p>:null}
    {error?<p class="ai-error">{error}</p>:null}
    <p class="ai-muted">Paid AI plans can be purchased securely with Telegram Stars. Pro can also be arranged directly with the administrator. All paid plans last 30 days.</p>
  </main>;
}
