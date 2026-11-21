import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { openLink } from "../tg";

type Item = { id:number; title:string; description:string; image_url:string|null; button_text:string; button_enabled:number; button_url:string|null };
type UserInfo = { firstName?:string; lastName?:string|null; username?:string|null; balanceInr?:number; supportUsername?:string|null; brand?:{name?:string} };

export function AnnouncementPopup({ me }: { me:UserInfo }) {
  const [item,setItem]=useState<Item|null>(null);
  const [closing,setClosing]=useState(false);
  useEffect(()=>{let live=true;api<{announcement:Item|null}>("/announcements/current").then(r=>{if(live)setItem(r.announcement)}).catch(()=>{});return()=>{live=false};},[]);
  const dismiss=async()=>{if(!item||closing)return;setClosing(true);try{await api("/announcements/"+item.id+"/dismiss",{method:"POST",body:{}});}catch{}setItem(null);};
  if(!item)return null;
  const vars:Record<string,string>={name:[me.firstName,me.lastName].filter(Boolean).join(" ")||"there",username:me.username?("@"+me.username):"",balance:Number(me.balanceInr??0).toFixed(2),brand:me.brand?.name??"",support:me.supportUsername?("@"+me.supportUsername):"Support"};
  const fill=(value:string)=>value.replace(/\\{([a-z][a-z0-9_]*)\\}/gi,(whole,key)=>vars[key.toLowerCase()]??whole);
  const title=fill(item.title),description=fill(item.description);
  const action=()=>{if(item.button_enabled&&item.button_url){openLink(item.button_url);void dismiss();}else void dismiss();};
  return <div class="announcement-backdrop" role="dialog" aria-modal="true" aria-label={title}>
    <div class="announcement-modal">
      <button type="button" class="announcement-close" aria-label="Close announcement" onClick={()=>void dismiss()}>×</button>
      {item.image_url?<img class="announcement-image" src={item.image_url} alt=""/>:null}
      <div class="announcement-content">
        <span class="announcement-eyebrow">ANNOUNCEMENT</span>
        <h2>{title}</h2>
        {description?<p>{description}</p>:null}
        <button type="button" class="announcement-action" onClick={action}>{fill(item.button_text||"Continue")}</button>
      </div>
    </div>
  </div>;
}
