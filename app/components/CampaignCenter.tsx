"use client";

import { useEffect, useMemo, useState } from "react";
import { CampaignReplay } from "./CampaignReplay";
import type { CampaignReplayData } from "@/lib/game/campaign-replay";
import {
  campaignChapters,
  campaignLevels,
  chapterIsComplete,
  earnedStars,
  levelIsUnlocked,
  levelsForChapter,
  type CampaignLevel,
  type CampaignLevelProgress,
} from "@/lib/game/campaign";

interface CampaignCenterProps {
  progress: Record<string, CampaignLevelProgress>;
  claimedLicenses: string[];
  onStart: (level: CampaignLevel) => void;
}

function masteryLabel(stars: number, levels: number) {
  const average = levels ? stars / levels : 0;
  if (average >= 2.5) return "Mastered";
  if (average >= 1.5) return "Independent";
  if (average >= 0.5) return "Practising";
  return "Introduced";
}

export function CampaignCenter({ progress, claimedLicenses, onStart }: CampaignCenterProps) {
  const [tab, setTab] = useState<"path" | "console">("path");
  const [replayLevels, setReplayLevels] = useState(new Set<string>());
  const [replay, setReplay] = useState<CampaignReplayData | null>(null);
  const firstAvailable = campaignLevels.find((level) => levelIsUnlocked(level, progress) && !(progress[level.id]?.bestStars));
  const [selectedId, setSelectedId] = useState(firstAvailable?.id ?? campaignLevels[0].id);
  const selected = campaignLevels.find((level) => level.id === selectedId) ?? campaignLevels[0];
  const completedLevels = campaignLevels.filter((level) => (progress[level.id]?.bestStars ?? 0) > 0);
  const stars = earnedStars(progress);
  const percent = Math.round(completedLevels.length / campaignLevels.length * 100);
  const currentRank = [...campaignChapters].reverse().find((chapter) => chapterIsComplete(chapter.number, progress))?.rank ?? "Recruit";
  const totalAttempts = Object.values(progress).reduce((sum, item) => sum + (item.attempts ?? 0), 0);
  const averageBest = completedLevels.length ? completedLevels.reduce((sum, level) => sum + (progress[level.id]?.bestAttemptSeconds ?? 0), 0) / completedLevels.length : 0;
  const averageContacts = completedLevels.length ? completedLevels.reduce((sum, level) => sum + (progress[level.id]?.bestCollisions ?? 0), 0) / completedLevels.length : 0;
  useEffect(() => { void fetch("/api/campaign-replays", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload: { replays?: Array<{ levelId: string }> } | null) => setReplayLevels(new Set(payload?.replays?.map((item) => item.levelId) ?? []))).catch(() => undefined); }, []);
  const watchReplay = async (levelId: string) => { const response = await fetch("/api/campaign-replays?levelId=" + encodeURIComponent(levelId) + "&slot=best", { cache: "no-store" }); if (response.ok) { const payload = await response.json() as { replay: CampaignReplayData }; setReplay(payload.replay); } };
  const recent = useMemo(() => Object.values(progress).filter((item) => item.completedAt).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))).slice(0, 5), [progress]);

  return (
    <section className="content-page page-width campaign-center">
      <div className="page-intro campaign-license-intro">
        <div><span className="eyebrow">Sumobot Pilot Academy</span><h1>Earn your AI Engineer certification.</h1><p>Advance through six mecha licenses by piloting, commanding, programming, and improving an autonomous unit.</p></div>
        <div className="campaign-rank-card"><small>CURRENT RANK</small><strong>{currentRank}</strong><span>{completedLevels.length}/36 missions · {stars}/108 stars</span><i><b style={{ width: `${percent}%` }} /></i><em>{percent}% complete</em></div>
      </div>

      <div className="campaign-main-tabs" role="tablist" aria-label="Campaign path and learning performance">
        <button type="button" role="tab" aria-selected={tab === "path"} className={tab === "path" ? "active" : ""} onClick={() => setTab("path")}><span>01</span><strong>Campaign Path</strong><small>Licenses, missions, and rewards</small></button>
        <button type="button" role="tab" aria-selected={tab === "console"} className={tab === "console" ? "active" : ""} onClick={() => setTab("console")}><span>02</span><strong>Learning Console</strong><small>Mastery and gradual improvement</small></button>
      </div>

      {tab === "path" ? <div className="campaign-path-layout">
        <div className="license-chapter-list">
          {campaignChapters.map((chapter) => {
            const levels = levelsForChapter(chapter.number);
            const complete = chapterIsComplete(chapter.number, progress);
            const unlocked = chapter.number === 1 || chapterIsComplete(chapter.number - 1, progress);
            const chapterStars = levels.reduce((sum, level) => sum + (progress[level.id]?.bestStars ?? 0), 0);
            const claimed = claimedLicenses.includes(String(chapter.number));
            return <article className={`license-chapter ${complete ? "completed" : unlocked ? "active" : "locked"}`} key={chapter.number}>
              <header><div className="license-rank-number">{String(chapter.number).padStart(2, "0")}</div><div><span>{chapter.license}</span><h2>{chapter.rank}</h2><p>{chapter.description}</p></div><div className="license-progress"><strong>{chapterStars}/18</strong><small>STARS</small><i><b style={{ width: `${chapterStars / 18 * 100}%` }} /></i></div></header>
              <div className="campaign-level-grid">
                {levels.map((level) => {
                  const item = progress[level.id];
                  const available = levelIsUnlocked(level, progress);
                  const active = level.id === selected.id;
                  return <button type="button" key={level.id} disabled={!available} className={`${active ? "selected" : ""} ${item?.bestStars ? "complete" : available ? "available" : "locked"}`} onClick={() => setSelectedId(level.id)}>
                    <span>{level.id}</span><strong>{level.title}</strong><small>{level.concept}</small><i>{item?.bestStars ? `${"★".repeat(item.bestStars)}${"☆".repeat(3 - item.bestStars)}` : available ? "READY" : "LOCKED"}</i>
                  </button>;
                })}
              </div>
              <footer><span><small>LICENSE BONUS</small><strong>{chapter.bonus.xp} XP · {chapter.bonus.gold} gold · {chapter.badge}</strong></span><b>{claimed ? "LICENSE EARNED" : complete ? "REWARD PENDING" : `${levels.filter((level) => progress[level.id]?.bestStars).length}/6 MISSIONS`}</b></footer>
            </article>;
          })}
        </div>

        <aside className="campaign-mission-dossier">
          <span className="eyebrow">Selected mission · {selected.id}</span>
          <h2>{selected.title}</h2>
          <strong>{selected.callSign} protocol</strong>
          <p>{selected.briefing}</p>
          <div className="dossier-tags"><span>{selected.mode}</span><span>{selected.kind.replaceAll("-", " ")}</span><span>{selected.playerTickMs} ms tick</span></div>
          <section><small>LEARNING OUTCOME</small><p>{selected.outcome}</p></section>
          <section><small>MISSION OBJECTIVES</small>{selected.objectives.map((objective) => <p key={objective}>→ {objective}</p>)}</section>
          <div className="dossier-reward"><small>FIRST COMPLETION</small><strong>{selected.reward.xp} XP</strong><strong>{selected.reward.gold} gold</strong></div>
          <div className="dossier-stars"><span>★ Complete the objective</span><span>★★ {selected.star2.label}</span><span>★★★ {selected.star3.label}</span></div>
          <div className="dossier-actions"><button type="button" disabled={!levelIsUnlocked(selected, progress)} onClick={() => onStart(selected)}>{progress[selected.id]?.bestStars ? "Replay mission" : "Launch mission"} →</button>{replayLevels.has(selected.id) && <button type="button" className="secondary" onClick={() => void watchReplay(selected.id)}>Watch best replay</button>}</div>
        </aside>
      </div> : <div className="learning-console">
        <div className="learning-summary-grid">
          <article><small>LICENSE RANK</small><strong>{currentRank}</strong><span>{claimedLicenses.length}/6 licenses earned</span></article>
          <article><small>MISSION MASTERY</small><strong>{completedLevels.length}/36</strong><span>{stars} total stars</span></article>
          <article><small>TRAINING ATTEMPTS</small><strong>{totalAttempts}</strong><span>{completedLevels.length ? (totalAttempts / completedLevels.length).toFixed(1) : "0"} attempts per completed mission</span></article>
          <article><small>BEST RUN AVERAGE</small><strong>{averageBest ? `${Math.round(averageBest)}s` : "—"}</strong><span>{averageContacts.toFixed(1)} contacts per best run</span></article>
        </div>

        <div className="learning-console-grid">
          <section className="concept-mastery-panel"><div><span className="eyebrow">Concept mastery</span><h2>From controls to autonomy.</h2><p>Mastery is based on your strongest evidence across related missions.</p></div>{campaignChapters.map((chapter) => {
            const levels = levelsForChapter(chapter.number);
            const chapterStars = levels.reduce((sum, level) => sum + (progress[level.id]?.bestStars ?? 0), 0);
            const label = masteryLabel(chapterStars, levels.length);
            return <article key={chapter.number}><span>{String(chapter.number).padStart(2, "0")}</span><div><strong>{chapter.rank}</strong><small>{chapter.concepts.join(" · ")}</small><i><b style={{ width: `${chapterStars / 18 * 100}%` }} /></i></div><em className={label.toLowerCase()}>{label}</em></article>;
          })}</section>

          <section className="learning-growth-panel"><span className="eyebrow">Chapter evidence</span><h2>Performance trajectory</h2><div className="chapter-evidence-bars">{campaignChapters.map((chapter) => {
            const levels = levelsForChapter(chapter.number);
            const value = levels.reduce((sum, level) => sum + (progress[level.id]?.bestStars ?? 0), 0);
            return <div key={chapter.number}><span>{chapter.rank}</span><i><b style={{ height: `${Math.max(4, value / 18 * 100)}%` }} /></i><strong>{value}</strong></div>;
          })}</div><p>{completedLevels.length ? `Your strongest current evidence is ${[...campaignChapters].sort((a, b) => levelsForChapter(b.number).reduce((sum, level) => sum + (progress[level.id]?.bestStars ?? 0), 0) - levelsForChapter(a.number).reduce((sum, level) => sum + (progress[level.id]?.bestStars ?? 0), 0))[0].rank}.` : "Complete the first mission to establish your learning baseline."}</p></section>

          <section className="learning-recent-panel"><span className="eyebrow">Learning record</span><h2>Recent evidence</h2>{recent.length ? recent.map((item) => {
            const level = campaignLevels.find((entry) => entry.id === item.levelId);
            return <article key={item.levelId}><span>{item.bestStars}★</span><div><strong>{level?.title ?? item.levelId}</strong><small>{level?.concept} · {item.attempts} attempt{item.attempts === 1 ? "" : "s"} · {Math.round(item.masteryScore ?? item.bestStars / 3 * 100)}% mastery</small></div><time>{item.improvementPercent ? `↑${item.improvementPercent}% · ` : ""}{item.bestAttemptSeconds ? `${Math.round(item.bestAttemptSeconds)}s best` : "Completed"}</time></article>;
          }) : <p className="console-empty">Your completed missions, best evidence, and improvements will appear here.</p>}</section>

          <section className="learning-next-panel"><span className="eyebrow">Recommended assignment</span><h2>{firstAvailable?.title ?? "Certification complete"}</h2><p>{firstAvailable?.outcome ?? "You have completed the full AI Engineer pathway. Improve mission stars or revisit any license trial."}</p>{firstAvailable && <button type="button" onClick={() => onStart(firstAvailable)}>Continue training →</button>}</section>
        </div>
      </div>}
      {replay && <CampaignReplay data={replay} onClose={() => setReplay(null)} />}
    </section>
  );
}

