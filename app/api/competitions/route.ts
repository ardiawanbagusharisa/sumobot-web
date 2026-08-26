import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/server";
import { enroll, enterQueue, listCompetitions, standings } from "@/lib/competitions/server";
export async function GET(request: Request) {
  const user=await getSessionUser(request); const url=new URL(request.url); const id=url.searchParams.get("standings");
  return NextResponse.json(id?{standings:await standings(id)}:{competitions:await listCompetitions(user)});
}
export async function POST(request: Request) {
  const user=await getSessionUser(request); if(!user)return NextResponse.json({error:"Sign in to join competitions."},{status:401});
  const body=await request.json() as Record<string,unknown>; const id=String(body.competitionId??"");
  const result=body.action==="queue"?await enterQueue(user,id,String(body.botId??""),String(body.mode??"")):await enroll(user,id);
  return NextResponse.json(result,{status:"error" in result?result.status:200});
}
