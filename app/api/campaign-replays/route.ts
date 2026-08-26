import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/server";
import { getCampaignReplay, listCampaignReplayMetadata, saveCampaignReplay } from "@/lib/campaign-replays/server";

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to view campaign replays." }, { status: 401 });
  const url = new URL(request.url);
  const levelId = url.searchParams.get("levelId");
  const slot = url.searchParams.get("slot") === "latest" ? "latest" : "best";
  if (!levelId) return NextResponse.json({ replays: await listCampaignReplayMetadata(user) });
  const replay = await getCampaignReplay(user, levelId.slice(0, 20), slot);
  return replay ? NextResponse.json({ replay }) : NextResponse.json({ error: "Replay not found." }, { status: 404 });
}

export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to save campaign replays." }, { status: 401 });
  const body = await request.json() as { replay?: unknown };
  const result = await saveCampaignReplay(user, body.replay);
  return NextResponse.json(result, { status: "error" in result ? result.status : 200 });
}
