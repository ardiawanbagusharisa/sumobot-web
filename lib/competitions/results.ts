import { getDatabase } from "@/lib/db/server";
import type { MatchResult } from "@/lib/game/rules";
import type { CompetitionRuleSet } from "./types";

export async function finalizeCompetitionRoom(roomId: string, winnerPlayerId: string | null, completionReason: "arena_exit" | "draw_timeout" | "disconnect" | null) {
  const db = await getDatabase();
  const pairing = await db.prepare(`SELECT cp.id,cp.competition_id AS competitionId,cp.player_a_id AS playerAId,cp.player_b_id AS playerBId,c.rules_json AS rules,c.status AS competitionStatus,c.ends_at AS ends
    FROM competition_pairings cp INNER JOIN competitions c ON c.id=cp.competition_id
    WHERE cp.room_id=? AND cp.status='live' LIMIT 1`).bind(roomId).first<{id:string;competitionId:string;playerAId:string;playerBId:string;rules:string;competitionStatus:string;ends:string}>();
  if (!pairing) return;
  const now = new Date().toISOString();
  if(pairing.competitionStatus!=="active"||now>pairing.ends){
    await db.batch([
      db.prepare("UPDATE competition_pairings SET status='pending',acceptance_expires_at=NULL,player_a_accepted_at=NULL,player_b_accepted_at=NULL,room_id=NULL,updated_at=? WHERE id=?").bind(now,pairing.id),
      db.prepare("UPDATE competition_queue_entries SET status='cancelled',pairing_id=NULL,updated_at=? WHERE competition_id=? AND pairing_id=?").bind(now,pairing.competitionId,pairing.id),
    ]);
    return;
  }
  if (completionReason === "disconnect") {
    await db.batch([
      db.prepare("UPDATE competition_pairings SET status='pending',acceptance_expires_at=NULL,player_a_accepted_at=NULL,player_b_accepted_at=NULL,room_id=NULL,updated_at=? WHERE id=?").bind(now,pairing.id),
      db.prepare("UPDATE competition_queue_entries SET status='waiting',pairing_id=NULL,updated_at=? WHERE competition_id=? AND pairing_id=?").bind(now,pairing.competitionId,pairing.id),
    ]);
    return;
  }
  const rules=JSON.parse(pairing.rules) as CompetitionRuleSet;
  const scoring=rules.scoring ?? {win:3,draw:1,loss:0};
  const participants=[pairing.playerAId,pairing.playerBId];
  const statements=[];
  for (const playerId of participants) {
    const result:MatchResult=!winnerPlayerId?"draw":winnerPlayerId===playerId?"win":"loss";
    statements.push(db.prepare("INSERT OR IGNORE INTO competition_results (id,competition_id,match_id,player_id,result,points,played_at) VALUES (?,?,?,?,?,?,?)").bind(`${pairing.id}:${playerId}`,pairing.competitionId,roomId,playerId,result,Number(scoring[result]),now));
  }
  statements.push(db.prepare("UPDATE competition_pairings SET status='completed',updated_at=? WHERE id=?").bind(now,pairing.id));
  statements.push(db.prepare("UPDATE competition_queue_entries SET status='waiting',pairing_id=NULL,updated_at=? WHERE competition_id=? AND pairing_id=?").bind(now,pairing.competitionId,pairing.id));
  await db.batch(statements);
}
