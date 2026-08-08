"use client";

import { useState } from "react";

export type DiagnosticAction = "forward" | "turnleft" | "turnright" | "dash" | "skill";

export interface BotDiagnosticSnapshot {
  name: string;
  elapsedSeconds: number;
  collisions: number;
  centerShare: number;
  actionCounts: Record<DiagnosticAction, number>;
  heatmap: number[];
}

interface BotDiagnosticsPanelsProps {
  left: BotDiagnosticSnapshot;
  right: BotDiagnosticSnapshot;
  temporary?: boolean;
}

function Panel({ side, snapshot, temporary }: { side: "left" | "right"; snapshot: BotDiagnosticSnapshot; temporary: boolean }) {
  const actionTotal = Object.values(snapshot.actionCounts).reduce((sum, count) => sum + count, 0);
  const heatMax = Math.max(1, ...snapshot.heatmap);
  return <aside className={`bot-diagnostics-panel ${side}`} aria-label={`${snapshot.name} diagnostics`}>
    <header><i /><span><strong>{snapshot.name}</strong><small>{temporary ? "temporary analysis" : "battle analysis"}</small></span></header>
    <div className="bot-diagnostics-metrics"><span><strong>{snapshot.elapsedSeconds.toFixed(1)}s</strong>elapsed</span><span><strong>{snapshot.collisions}</strong>hits</span><span><strong>{Math.round(snapshot.centerShare * 100)}%</strong>center</span></div>
    <div className="bot-diagnostics-actions">{Object.entries(snapshot.actionCounts).map(([action, count]) => <span key={action}><small>{action}</small><b><i style={{ width: `${actionTotal ? count / actionTotal * 100 : 0}%` }} /></b><strong>{count}</strong></span>)}</div>
    <div className="bot-diagnostics-heatmap" aria-label={`${snapshot.name} trajectory heatmap`}>{snapshot.heatmap.map((value, index) => <i key={index} style={{ opacity: value ? .18 + value / heatMax * .82 : .04 }} />)}</div>
  </aside>;
}

export function BotDiagnosticsPanels({ left, right, temporary = false }: BotDiagnosticsPanelsProps) {
  const [open, setOpen] = useState(true);
  return <div className={`bot-diagnostics-pair ${open ? "open" : "collapsed"}`}>
    <button className="bot-diagnostics-toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span>{open ? "‹ ›" : "› ‹"}</span> Analytics</button>
    {open && <><Panel side="left" snapshot={left} temporary={temporary} /><Panel side="right" snapshot={right} temporary={temporary} /></>}
  </div>;
}
