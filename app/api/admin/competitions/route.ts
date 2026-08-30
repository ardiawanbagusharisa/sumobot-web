import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/server";
import { adminDelete, adminSave, adminTransition, isCompetitionAdmin, listCompetitions } from "@/lib/competitions/service";

export async function GET(request:Request){
  const user=await getSessionUser(request);
  if(!user||!isCompetitionAdmin(user))return NextResponse.json({error:"Owner access required."},{status:403});
  return NextResponse.json({admin:true,competitions:await listCompetitions(user)});
}
export async function POST(request:Request){
  const user=await getSessionUser(request);
  if(!user)return NextResponse.json({error:"Sign in required."},{status:401});
  const body=await request.json() as Record<string,unknown>;
  const result=body.action==="transition"
    ?await adminTransition(user,String(body.id??""),String(body.status??"") as never)
    :body.action==="delete"
      ?await adminDelete(user,String(body.id??""))
      :await adminSave(user,body);
  return NextResponse.json(result,{status:"error" in result?result.status:200});
}
