"use client";
import { useCallback, useEffect, useState } from "react";
import type { Competition, CompetitionStanding } from "@/lib/competitions/types";
import type { ControlMode } from "@/lib/game/rules";

export function CompetitionCenter({ botId, mode, onNotice }: { botId: string; mode: ControlMode; onNotice: (message: string) => void }) {
  const [items,setItems]=useState<Competition[]>([]); const [selected,setSelected]=useState<string|null>(null); const [table,setTable]=useState<CompetitionStanding[]>([]);
  const refresh=useCallback(()=>fetch("/api/competitions",{cache:"no-store"}).then(r=>r.json()).then((p:{competitions:Competition[]})=>setItems(p.competitions??[])),[]);
  useEffect(()=>{void refresh()},[refresh]);
  const action=async(action:"enroll"|"queue",competitionId:string)=>{const r=await fetch("/api/competitions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,competitionId,botId,mode})});const p=await r.json() as {error?:string;queued?:boolean};onNotice(p.error??(p.queued?"Entered the dedicated competition queue.":"Competition enrollment confirmed."));await refresh()};
  const showStandings=async(id:string)=>{setSelected(id);const r=await fetch("/api/competitions?standings="+encodeURIComponent(id));const p=await r.json() as {standings:CompetitionStanding[]};setTable(p.standings??[])};
  return <section className="content-page page-width competition-page"><div className="page-intro"><div><span className="eyebrow">Seasonal competition</span><h1>Learn, then prove it in the arena.</h1><p>Opt into a timed ladder. Only matches launched from its dedicated queue affect seasonal standings.</p></div></div>
    <div className="competition-grid">{items.length?items.map(item=><article key={item.id} className={item.status}><header><span>{item.status}</span><strong>{item.title}</strong></header><p>{item.description}</p><div><small>{new Date(item.startsAt).toLocaleString()} → {new Date(item.endsAt).toLocaleString()}</small><small>{item.rules.controlModes.join(" / ")} · {item.rules.roundSeconds}s · {item.rules.actionIntervalMs}ms · {item.rules.matchLimit} matches</small><strong>{item.rules.scoring.win}/{item.rules.scoring.draw}/{item.rules.scoring.loss} points W/D/L</strong></div><footer>{!item.enrolled?<button type="button" disabled={!["registration","active"].includes(item.status)} onClick={()=>void action("enroll",item.id)}>Opt in</button>:<button type="button" disabled={item.status!=="active"||!item.rules.controlModes.includes(mode)} onClick={()=>void action("queue",item.id)}>Enter {mode} queue</button>}<button type="button" className="secondary" onClick={()=>void showStandings(item.id)}>Standings</button></footer></article>):<p>No published competition is available yet.</p>}</div>
    {selected&&<section className="competition-standings"><h2>Season standings</h2>{table.length?table.map(row=><div key={row.playerId}><strong>#{row.rank}</strong><span>{row.displayName}</span><span>{row.wins}W · {row.draws}D · {row.losses}L</span><b>{row.points} pts</b></div>):<p>No eligible results yet.</p>}</section>}
  </section>;
}
