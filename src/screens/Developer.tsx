import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { back } from "../router";
import { openTelegramLink, useBackButton } from "../tg";
import { LargeTitle, List, Row, Screen, Section, Skeleton, toast } from "../ui";

type DeveloperInfo = { id:number; firstName:string; lastName:string; username:string; photoUrl:string|null };

export function Developer() {
  const [info,setInfo] = useState<DeveloperInfo>({id:7062424671,firstName:"",lastName:"",username:"devheroo",photoUrl:null});
  const [loaded,setLoaded] = useState(false);
  useBackButton(() => back("/profile"));
  useEffect(() => {
    let live = true;
    api<DeveloperInfo>("/developer/profile").then(v => { if(live) setInfo(v); })
      .catch(() => { if(live) toast("Could not load Telegram profile details", "error"); })
      .finally(() => { if(live) setLoaded(true); });
    return () => { live = false; };
  }, []);
  const name = [info.firstName,info.lastName].filter(Boolean).join(" ") || "Telegram Developer";
  return (
    <Screen>
      <LargeTitle align="center" size="title2"
        lead={<span class="avatar">{info.photoUrl ? <img src={info.photoUrl} alt="" /> : <span>👨‍💻</span>}</span>}
        title={<bdi>{name}</bdi>}
        sub={<bdi dir="ltr">@{info.username || "devheroo"}</bdi>}
      />
      <Section footer="Official developer contact for this Mini App.">
        <List>
          <Row icon="user" title="Developer ID" value="7062424671" />
          <Row icon="send" title="Telegram" value="@devheroo" onClick={() => openTelegramLink("https://t.me/devheroo")} external />
        </List>
      </Section>
      <Section footer="Telegram bots, automation and modern Mini App experiences.">
        <List>
          <Row icon="code" title="About" meta="Independent Bot & Mini App Developer" />
          <Row icon="layers" title="Specialization" meta="Telegram automation · Bot development · Web applications" />
          <Row icon="message-circle" title="Contact for projects" meta="Open Telegram to discuss a project" onClick={() => openTelegramLink("https://t.me/devheroo")} />
        </List>
      </Section>
      {!loaded ? <Skeleton h={12} /> : null}
    </Screen>
  );
}
