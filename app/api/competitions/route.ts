import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/server";
import { acceptAssignment, challengeOpponent, competitionDetail, competitionReplay, enroll, listCompetitions, standby, standings } from "@/lib/competitions/service";

export async function GET(request: Request) {
  const user=await getSessionUser(request);
  const url=new URL(request.url);
  const detailId=url.searchParams.get("detail"),standingsId=url.searchParams.get("standings"),cards=url.searchParams.get("cards"),replayId=url.searchParams.get("replay"),competitionId=url.searchParams.get("competitionId");
  if(replayId&&competitionId){const result=await competitionReplay(user,competitionId,replayId);return NextResponse.json(result,{status:"error" in result?result.status:200,headers:{"Cache-Control":"private, no-store"}})}
  if(cards==="1"){
    const competitions=await listCompetitions(user);
    const entries=await Promise.all(competitions.map(async(item)=>[item.id,await competitionDetail(user,item.id)] as const));
    return NextResponse.json({competitions,details:Object.fromEntries(entries)},{headers:{"Cache-Control":"no-store"}});
  }
  if(detailId)return NextResponse.json({detail:await competitionDetail(user,detailId)},{headers:{"Cache-Control":"no-store"}});
  if(standingsId)return NextResponse.json({standings:await standings(standingsId)},{headers:{"Cache-Control":"no-store"}});
  return NextResponse.json({competitions:await listCompetitions(user)},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request: Request) {
  const user=await getSessionUser(request);
  if(!user)return NextResponse.json({error:"Sign in to join competitions."},{status:401});
  const body=await request.json() as Record<string,unknown>;
  const competitionId=String(body.competitionId??"");
  const result=body.action==="standby"
    ?await standby(user,competitionId,body.bot)
    :body.action==="accept"
      ?await acceptAssignment(user,competitionId,String(body.pairingId??""))
      :body.action==="challenge"
        ?await challengeOpponent(user,competitionId,String(body.opponentId??""))
        :await enroll(user,competitionId,typeof body.accessCode==="string"?body.accessCode:undefined);
  return NextResponse.json(result,{status:"error" in result?result.status:200});
}
